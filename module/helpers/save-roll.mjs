import { CORoll } from "../documents/roll.mjs"
import { Resolver } from "../models/schemas/resolver.mjs"

export default class SaveRollHandler {
  /**
   * Résout un jet de sauvegarde pour un acteur cible.
   * @param {object} params
   * @param {Actor} params.targetActor L'acteur qui fait le jet de sauvegarde
   * @param {string} params.saveAbility La caractéristique utilisée pour la sauvegarde
   * @param {string} params.difficulty La difficulté du jet
   * @returns {Promise<object|null>} Le résultat du jet, ou null si annulé
   */
  static async resolveSaveRoll({ targetActor, saveAbility, difficulty }) {
    const targetRollSkill = await targetActor.rollSkill(saveAbility, { difficulty, showResult: false, showOppositeRoll: false })
    if (!targetRollSkill) return null

    const rollResult = CORoll.analyseRollResult(targetRollSkill.roll)
    const actorId = targetActor.id ?? targetRollSkill.roll.options?.actorId
    const actorObj = actorId ? game.actors.get(actorId) : null
    const hasLucky = actorObj?.type === "character" && (actorObj?.system?.resources?.fortune?.value ?? 0) > 0

    return {
      roll: targetRollSkill.roll,
      rollResult,
      actorId,
      saveHasLuckyPoints: hasLucky && !rollResult.isCritical,
    }
  }

  /**
   * Dépense un point de chance du sauveur : +10 sur le jet de sauvegarde.
   * @param {object} params
   * @param {Actor} params.saverActor L'acteur qui dépense son point de chance
   * @param {ChatMessage} params.message Le message de chat
   * @param {string} params.targetUuid UUID de la cible dans targetResults
   */
  static async spendSaverLuckyPoint({ saverActor, message, targetUuid, deferEffects = false }) {
    if (!saverActor) return

    if (saverActor.system.resources.fortune.value > 0) {
      saverActor.system.resources.fortune.value -= 1
      await saverActor.update({ "system.resources.fortune.value": saverActor.system.resources.fortune.value })
    }

    const rolls = [...message.rolls]
    const rollIndex = rolls.findIndex((r) => r.options?.actorId === saverActor.id)
    if (rollIndex < 0) return

    const roll = rolls[rollIndex]
    roll.options.bonus = String(parseInt(roll.options.bonus) + 10)
    roll.options.hasLuckyPoints = false
    roll.options.luckyPointUsed = true
    roll._total = parseInt(roll.total) + 10

    const newResult = CORoll.analyseRollResult(roll)

    const currentTargetResults = message.system.targetResults ?? []
    const newTargetResults = currentTargetResults.map((tr) => {
      if (tr.uuid !== targetUuid) return tr
      return {
        ...tr,
        total: newResult.total,
        isSuccess: newResult.isSuccess ?? false,
        isFailure: newResult.isFailure ?? false,
        isCritical: newResult.isCritical ?? false,
        isFumble: newResult.isFumble ?? false,
        saveHasLuckyPoints: false,
      }
    })

    // Si les effets sont différés (save avec DM), ne pas appliquer maintenant
    if (!deferEffects) {
      const targetActor = fromUuidSync(targetUuid)
      if (targetActor) {
        await SaveRollHandler.applyEffects({
          customEffect: message.system.customEffect,
          additionalEffect: message.system.additionalEffect,
          result: newResult,
          targetActor,
        })
      }
    }

    await SaveRollHandler.updateMessage({ message, updateData: { rolls, "system.targetResults": newTargetResults } })
  }

  /**
   * Applique les effets personnalisés si les conditions sont remplies.
   * @param {object} params
   * @param {object} params.customEffect L'effet personnalisé à appliquer
   * @param {object} params.additionalEffect Configuration de l'effet additionnel
   * @param {object} params.result Résultat du jet (isSuccess, isFailure, etc.)
   * @param {Actor} params.targetActor L'acteur cible
   */
  static async applyEffects({ customEffect, additionalEffect, result, targetActor }) {
    if (!customEffect || !additionalEffect || !additionalEffect.active) return
    if (!Resolver.shouldManageAdditionalEffect(result, additionalEffect)) return
    if (game.user.isGM) await targetActor.applyCustomEffect(customEffect)
    else {
      await game.users.activeGM.query("co2.applyCustomEffect", { ce: customEffect, targets: [targetActor.uuid] })
    }
  }

  /**
   * Met à jour un message de chat (via le MJ si nécessaire).
   * @param {object} params
   * @param {ChatMessage} params.message Le message à mettre à jour
   * @param {object} params.updateData Les données de mise à jour
   */
  static async updateMessage({ message, updateData }) {
    if (game.user.isGM) {
      await message.update(updateData)
    } else {
      await game.users.activeGM.query("co2.updateMessageAfterSavedRoll", {
        existingMessageId: message.id,
        rolls: updateData.rolls,
        targetResults: updateData["system.targetResults"],
      })
    }
  }
}

import BaseMessageData from "./base-message.mjs"
import CustomEffectData from "./schemas/custom-effect.mjs"
import Utils from "../helpers/utils.mjs"
import SaveRollHandler from "../helpers/save-roll.mjs"

export default class SaveMessageData extends BaseMessageData {
  static defineSchema() {
    const fields = foundry.data.fields
    return foundry.utils.mergeObject(super.defineSchema(), {
      ability: new fields.StringField({ required: true }),
      difficulty: new fields.StringField({ required: true }),
      difficultyFormula: new fields.StringField({ required: false, nullable: true, blank: true }),
      customEffect: new fields.EmbeddedDataField(CustomEffectData),
      additionalEffect: new fields.SchemaField({
        active: new fields.BooleanField({ initial: false }),
        applyOn: new fields.StringField({ required: true, choices: SYSTEM.RESOLVER_RESULT, initial: SYSTEM.RESOLVER_RESULT.success.id }),
        successThreshold: new fields.NumberField({ integer: true, positive: true }),
        statuses: new fields.SetField(new fields.StringField({ required: true, blank: true, choices: SYSTEM.RESOLVER_ADDITIONAL_EFFECT_STATUS })),
        duration: new fields.StringField({ required: true, nullable: false, initial: "0" }),
        unit: new fields.StringField({ required: true, choices: SYSTEM.COMBAT_UNITE, initial: SYSTEM.COMBAT_UNITE.round.id }),
        formula: new fields.StringField({ required: false }),
        formulaType: new fields.StringField({ required: false, choices: SYSTEM.RESOLVER_FORMULA_TYPE }),
        elementType: new fields.StringField({ required: false }),
      }),
      targetResults: new fields.ArrayField(
        new fields.SchemaField({
          uuid: new fields.StringField({ required: false, nullable: true, blank: true }),
          name: new fields.StringField({ required: false, nullable: true, blank: true }),
          img: new fields.StringField({ required: false, nullable: true, blank: true }),
          needsSaveRoll: new fields.BooleanField({ initial: true }),
          total: new fields.NumberField({ required: false, nullable: true, integer: true }),
          isSuccess: new fields.BooleanField({ initial: false }),
          isFailure: new fields.BooleanField({ initial: false }),
          isCritical: new fields.BooleanField({ initial: false }),
          isFumble: new fields.BooleanField({ initial: false }),
          saveActorId: new fields.StringField({ required: false, nullable: true, blank: true }),
          saveHasLuckyPoints: new fields.BooleanField({ initial: false }),
          rollFormula: new fields.StringField({ required: false, nullable: true, blank: true }),
          rollTooltip: new fields.StringField({ required: false, nullable: true, blank: true }),
        }),
        { required: false, initial: [] },
      ),
    })
  }

  /**
   * Modifie le contenu HTML d'un message
   * @async
   * @param {COChatMessage} message Le document ChatMessage en cours de rendu.
   * @param {HTMLElement} html Element HTML representant le message a modifier.
   * @returns {Promise<void>} Resout lorsque le HTML a ete mis a jour.
   */
  async alterMessageHTML(message, html) {
    this._buildMultiTargetHTML(message, html)
  }

  /**
   * Ajoute les listeners du message
   * @async
   * @param {HTMLElement} html Element HTML representant le message a modifier.
   */
  async addListeners(html) {
    this._addMultiTargetListeners(html)
  }

  // ----------------------------------------------------------------
  //  Multi-cible : construction du HTML des lignes cibles
  // ----------------------------------------------------------------

  _buildMultiTargetHTML(message, html) {
    const displayDifficulty = game.settings.get("co2", "displayDifficulty")
    const showDifficulty = displayDifficulty === "all" || (displayDifficulty === "gm" && game.user.isGM)

    if (displayDifficulty === "gm" && !game.user.isGM) {
      html.querySelectorAll(".display-difficulty").forEach((el) => el.remove())
    }

    const targetsSection = html.querySelector(".targets")
    if (!targetsSection) return

    targetsSection.innerHTML = ""

    const targetResults = message.system.targetResults ?? []
    if (targetResults.length === 0) return

    const details = document.createElement("details")
    details.classList.add("targets-collapsible")
    details.open = true

    const summary = document.createElement("summary")
    summary.classList.add("targets-header")
    summary.innerHTML = `<i class="fa-solid fa-bullseye-arrow"></i> ${game.i18n.localize("CO.ui.targets")}`
    details.appendChild(summary)

    const ul = document.createElement("ul")
    ul.classList.add("target-list")

    for (const tr of targetResults) {
      const li = document.createElement("li")
      li.classList.add("target-row")
      li.dataset.targetUuid = tr.uuid

      // Icone d'etat
      if (showDifficulty) {
        const outcomeSpan = document.createElement("span")
        if (tr.needsSaveRoll) {
          outcomeSpan.className = "target-outcome pending"
          outcomeSpan.dataset.tooltip = game.i18n.localize("CO.ui.saves")
          outcomeSpan.dataset.tooltipDirection = "LEFT"
          outcomeSpan.innerHTML = `<i class="fas fa-question"></i>`
        } else if (tr.isCritical) {
          outcomeSpan.className = "target-outcome success critical"
          outcomeSpan.dataset.tooltip = game.i18n.localize("CO.roll.critical")
          outcomeSpan.dataset.tooltipDirection = "LEFT"
          outcomeSpan.innerHTML = `<i class="fas fa-check-double"></i>`
        } else if (tr.isFumble) {
          outcomeSpan.className = "target-outcome failure fumble"
          outcomeSpan.dataset.tooltip = game.i18n.localize("CO.roll.fumble")
          outcomeSpan.dataset.tooltipDirection = "LEFT"
          outcomeSpan.innerHTML = `<i class="fas fa-skull-crossbones"></i>`
        } else if (tr.isSuccess) {
          outcomeSpan.className = "target-outcome success"
          outcomeSpan.dataset.tooltip = game.i18n.localize("CO.roll.success")
          outcomeSpan.dataset.tooltipDirection = "LEFT"
          outcomeSpan.innerHTML = `<i class="fas fa-check"></i>`
        } else if (tr.isFailure) {
          outcomeSpan.className = "target-outcome failure"
          outcomeSpan.dataset.tooltip = game.i18n.localize("CO.roll.failure")
          outcomeSpan.dataset.tooltipDirection = "LEFT"
          outcomeSpan.innerHTML = `<i class="fas fa-times"></i>`
        }
        li.appendChild(outcomeSpan)
      }

      // Portrait
      if (tr.img) {
        const img = document.createElement("img")
        img.classList.add("target-portrait")
        img.src = tr.img
        img.dataset.tooltip = tr.name
        img.height = 32
        img.width = 32
        li.appendChild(img)
      }

      // Nom
      const nameSpan = document.createElement("span")
      nameSpan.classList.add("target-name")
      nameSpan.textContent = tr.name
      li.appendChild(nameSpan)

      if (tr.needsSaveRoll) {
        // Bouton de jet de sauvegarde
        const btn = document.createElement("button")
        btn.classList.add("save-roll")
        btn.dataset.saveTarget = tr.uuid
        btn.dataset.saveAbility = message.system.ability
        btn.dataset.saveDifficulty = message.system.difficulty
        const abilityLabel = game.i18n.localize(`CO.abilities.long.${message.system.ability}`)
        btn.dataset.tooltip = `${game.i18n.localize("CO.ui.saves")} : ${abilityLabel}`
        btn.dataset.tooltipDirection = "UP"
        btn.textContent = game.i18n.localize("CO.ui.saves")
        li.appendChild(btn)
      } else {
        // Total du jet
        if (showDifficulty) {
          const totalSpan = document.createElement("span")
          totalSpan.classList.add("target-total")
          const abilityLabel = game.i18n.localize(`CO.abilities.long.${message.system.ability}`)
          const tooltipParts = [`${game.i18n.localize("CO.ui.saves")} : ${abilityLabel}`]
          if (tr.rollFormula) tooltipParts.push(tr.rollFormula)
          totalSpan.dataset.tooltip = tooltipParts.join(" — ")
          totalSpan.dataset.tooltipDirection = "UP"
          totalSpan.innerHTML = `<i class="fas fa-shield-exclamation"></i> ${tr.total}`
          li.appendChild(totalSpan)
        }

        // Bouton point de chance
        if (tr.saveHasLuckyPoints && !tr.isCritical) {
          const lpLink = document.createElement("a")
          lpLink.classList.add("lp-button-save-target")
          lpLink.dataset.targetUuid = tr.uuid
          lpLink.dataset.actorId = tr.saveActorId
          lpLink.innerHTML = `<i class="fa-regular fa-clover" data-tooltip="${game.i18n.localize("CO.dialogs.spendLuckyPoint")}" data-tooltip-direction="UP"></i>`
          li.appendChild(lpLink)
        }
      }

      ul.appendChild(li)
    }

    details.appendChild(ul)
    targetsSection.appendChild(details)
  }

  // ----------------------------------------------------------------
  //  Multi-cible : listeners
  // ----------------------------------------------------------------

  _addMultiTargetListeners(html) {
    // Boutons de jet de sauvegarde par cible
    const saveButtons = html.querySelectorAll(".target-row .save-roll")
    saveButtons.forEach((btn) => {
      const targetUuid = btn.dataset.saveTarget
      const targetActor = fromUuidSync(targetUuid)
      if (!targetActor) return

      const canClick = game.user.isGM || targetActor.isOwner
      if (!canClick) {
        btn.style.visibility = "hidden"
        return
      }

      btn.addEventListener("click", async (event) => {
        event.preventDefault()
        event.stopPropagation()

        const messageId = event.currentTarget.closest(".message").dataset.messageId
        if (!messageId) return
        const message = game.messages.get(messageId)
        if (!message) return

        const saveAbility = btn.dataset.saveAbility
        const difficulty = btn.dataset.saveDifficulty

        const resolved = await SaveRollHandler.resolveSaveRoll({ targetActor, saveAbility, difficulty })
        if (!resolved) return

        const currentTargetResults = message.system.targetResults ?? []
        const newTargetResults = currentTargetResults.map((tr) => {
          if (tr.uuid !== targetUuid) return tr
          return {
            ...tr,
            needsSaveRoll: false,
            total: resolved.rollResult.total,
            isSuccess: resolved.rollResult.isSuccess ?? false,
            isFailure: resolved.rollResult.isFailure ?? false,
            isCritical: resolved.rollResult.isCritical ?? false,
            isFumble: resolved.rollResult.isFumble ?? false,
            saveActorId: resolved.actorId,
            saveHasLuckyPoints: resolved.saveHasLuckyPoints,
            rollFormula: resolved.roll.formula,
            rollTooltip: resolved.roll.options?.toolTip ?? "",
          }
        })

        const rolls = [...this.parent.rolls, resolved.roll]

        await SaveRollHandler.applyEffects({
          customEffect: message.system.customEffect,
          additionalEffect: message.system.additionalEffect,
          result: resolved.rollResult,
          targetActor,
        })

        await SaveRollHandler.updateMessage({ message, updateData: { rolls, "system.targetResults": newTargetResults } })
      })
    })

    // Boutons de points de chance par cible
    const luckyButtons = html.querySelectorAll(".lp-button-save-target")
    luckyButtons.forEach((btn) => {
      const actorId = btn.dataset.actorId
      const saverActor = actorId ? game.actors.get(actorId) : null
      if (!saverActor || (!game.user.isGM && !saverActor.isOwner)) return

      btn.addEventListener("click", async (event) => {
        event.preventDefault()
        event.stopPropagation()

        const messageId = event.currentTarget.closest(".message").dataset.messageId
        if (!messageId) return
        const message = game.messages.get(messageId)
        if (!message) return

        const targetUuid = btn.dataset.targetUuid
        await SaveRollHandler.spendSaverLuckyPoint({ saverActor, message, targetUuid })
      })
    })

    // Interactions hover/click sur les lignes cibles (highlight token)
    const associatedActor = this.parent.getAssociatedActor?.()
    const canInteractWithTargets = game.user.isGM || this.parent.isAuthor || associatedActor?.isOwner
    let highlightedTargetToken = null
    const targetRows = html.querySelectorAll(".target-row[data-target-uuid]")
    targetRows.forEach((targetRow) => {
      if (!canInteractWithTargets) return

      targetRow.classList.add("is-interactive")

      targetRow.addEventListener("click", async (event) => {
        if (event.target.closest("button, a")) return
        event.preventDefault()
        event.stopPropagation()

        const targetReference = Utils.resolveChatTargetReference(targetRow.dataset.targetUuid)
        const targetToken = targetReference?.token
        if (!targetReference?.canLocate || !targetToken || !canvas?.ready) return

        if (targetReference.canControl) {
          targetToken.control({ releaseOthers: !event.shiftKey })
        }
        await canvas.animatePan(targetToken.center)
      })

      targetRow.addEventListener("pointerover", (event) => {
        const targetReference = Utils.resolveChatTargetReference(targetRow.dataset.targetUuid)
        const targetToken = targetReference?.token
        if (!targetReference?.canLocate || !targetToken?.isVisible || targetToken.controlled) return
        targetToken._onHoverIn(event, { hoverOutOthers: true })
        highlightedTargetToken = targetToken
      })

      targetRow.addEventListener("pointerout", (event) => {
        const targetReference = Utils.resolveChatTargetReference(targetRow.dataset.targetUuid)
        const targetToken = targetReference?.token
        if (!targetToken || highlightedTargetToken !== targetToken) return
        targetToken._onHoverOut(event)
        highlightedTargetToken = null
      })
    })
  }

}

import BaseMessageData from "./base-message.mjs"
import CustomEffectData from "./schemas/custom-effect.mjs"
import Utils from "../helpers/utils.mjs"
import SaveRollHandler from "../helpers/save-roll.mjs"
import Hitpoints from "../helpers/hitpoints.mjs"
import { Resolver } from "./schemas/resolver.mjs"

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
      dmgTotal: new fields.NumberField({ required: false, nullable: true, initial: null }),
      dmgFormula: new fields.StringField({ required: false, nullable: true, blank: true }),
      dmgTooltip: new fields.HTMLField({ required: false, nullable: true, blank: true }),
      halfDmgOnSave: new fields.BooleanField({ initial: true }),
      appliedTempDamage: new fields.BooleanField({ required: false, nullable: true, initial: null }),
      dmgApplied: new fields.BooleanField({ initial: false }),
      effectsApplied: new fields.BooleanField({ initial: false }),
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
          appliedMultiplier: new fields.NumberField({ required: false, nullable: true, initial: null }),
          appliedDrChecked: new fields.BooleanField({ initial: true }),
        }),
        { required: false, initial: [] },
      ),
    })
  }

  get hasDmg() {
    return this.dmgTotal !== null && this.dmgTotal !== undefined
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
    const hasDmg = message.system.hasDmg
    const dmgTotal = message.system.dmgTotal ?? 0
    const halfDmgOnSave = message.system.halfDmgOnSave

    if (displayDifficulty === "gm" && !game.user.isGM) {
      html.querySelectorAll(".display-difficulty").forEach((el) => el.remove())
    }

    // Masquer le bouton Appliquer et la section DM pour les non-MJ (sauf si allowPlayersToModifyTargets)
    if (hasDmg && !game.user.isGM && !game.settings.get("co2", "allowPlayersToModifyTargets")) {
      const applySection = html.querySelector(".save-apply-section")
      if (applySection) applySection.style.display = "none"
      const dmgOptions = html.querySelector(".save-dmg-options")
      if (dmgOptions) dmgOptions.style.display = "none"
    }

    // Restaure l'état de la checkbox DM temporaires
    if (hasDmg) {
      const tempDmCheckbox = html.querySelector("#saveTempDm")
      if (tempDmCheckbox && message.system.appliedTempDamage !== null) {
        tempDmCheckbox.checked = message.system.appliedTempDamage
      }
    }

    // Désactive le bouton Appliquer si déjà appliqué
    if (hasDmg && message.system.dmgApplied) {
      const applyBtn = html.querySelector(".save-apply-btn")
      if (applyBtn) {
        applyBtn.disabled = true
        applyBtn.textContent = game.i18n.localize("CO.ui.applied")
      }
    }

    const targetsSection = html.querySelector(".targets")
    if (!targetsSection) return

    targetsSection.innerHTML = ""

    const targetResults = message.system.targetResults ?? []
    if (targetResults.length === 0) return

    const details = document.createElement("details")
    details.classList.add("targets-collapsible")
    details.open = !hasDmg || !message.system.dmgApplied

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

      // --- Ligne 1 : icône résultat, portrait, nom, total sauvegarde, DM, point de chance ---
      const infoLine = document.createElement("div")
      infoLine.classList.add("target-row-info")

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
        infoLine.appendChild(outcomeSpan)
      }

      // Portrait
      if (tr.img) {
        const img = document.createElement("img")
        img.classList.add("target-portrait")
        img.src = tr.img
        img.dataset.tooltip = tr.name
        img.height = 32
        img.width = 32
        infoLine.appendChild(img)
      }

      // Nom
      const nameSpan = document.createElement("span")
      nameSpan.classList.add("target-name")
      nameSpan.textContent = tr.name
      infoLine.appendChild(nameSpan)

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
        infoLine.appendChild(btn)
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
          infoLine.appendChild(totalSpan)
        }

        // Montant DM sur la ligne 1 (si DM défini et jet résolu)
        if (hasDmg) {
          const targetActor = fromUuidSync(tr.uuid)
          const targetDr = targetActor?.system?.combat?.dr?.value ?? 0
          const defaultMultiplier = SaveMessageData.getDefaultMultiplier(tr, halfDmgOnSave)
          const effectiveMultiplier = (tr.appliedMultiplier !== null && tr.appliedMultiplier !== undefined) ? tr.appliedMultiplier : defaultMultiplier
          const drChecked = tr.appliedDrChecked
          const initialDmgDisplay = SaveMessageData.computeDamageDisplay(dmgTotal, effectiveMultiplier, drChecked, targetDr)

          const dmgSpan = document.createElement("span")
          dmgSpan.classList.add("target-damage")
          dmgSpan.dataset.multiplier = effectiveMultiplier
          dmgSpan.textContent = initialDmgDisplay
          infoLine.appendChild(dmgSpan)
        }

        // Bouton point de chance
        if (tr.saveHasLuckyPoints && !tr.isCritical) {
          const lpLink = document.createElement("a")
          lpLink.classList.add("lp-button-save-target")
          lpLink.dataset.targetUuid = tr.uuid
          lpLink.dataset.actorId = tr.saveActorId
          lpLink.innerHTML = `<i class="fa-regular fa-clover" data-tooltip="${game.i18n.localize("CO.dialogs.spendLuckyPoint")}" data-tooltip-direction="UP"></i>`
          infoLine.appendChild(lpLink)
        }
      }

      li.appendChild(infoLine)

      // --- Ligne 2 : RD + multiplicateurs (si DM défini et jet résolu) ---
      if (!tr.needsSaveRoll && hasDmg) {
        const controlsLine = document.createElement("div")
        controlsLine.classList.add("save-target-dmg-row")
        controlsLine.dataset.targetUuid = tr.uuid

        const targetActor = fromUuidSync(tr.uuid)
        const targetDr = targetActor?.system?.combat?.dr?.value ?? 0
        controlsLine.dataset.targetDr = targetDr

        const defaultMultiplier = SaveMessageData.getDefaultMultiplier(tr, halfDmgOnSave)
        const effectiveMultiplier = (tr.appliedMultiplier !== null && tr.appliedMultiplier !== undefined) ? tr.appliedMultiplier : defaultMultiplier
        const drChecked = tr.appliedDrChecked

        const drLabel = game.i18n.localize("CO.ui.dr")
        const drTooltip = game.i18n.localize("CO.ui.drText")

        controlsLine.innerHTML = `
          <div class="damage-multipliers">
            <label class="target-dr-label" data-tooltip="${drTooltip}" data-tooltip-direction="UP">
              ${drLabel}
              <input type="checkbox" class="target-dr" ${drChecked ? "checked" : ""} />
            </label>
            <button type="button" class="multiplier-btn btn-heal" data-multiplier="-1" data-tooltip="${game.i18n.localize("CO.ui.applyHealing")}" data-tooltip-direction="DOWN"><i class="fa-solid fa-heart"></i></button>
            <button type="button" class="multiplier-btn ${effectiveMultiplier === 0 ? "active" : ""}" data-multiplier="0" data-tooltip="${game.i18n.localize("CO.ui.noDamage")}" data-tooltip-direction="DOWN">0</button>
            <button type="button" class="multiplier-btn ${effectiveMultiplier === 0.5 ? "active" : ""}" data-multiplier="0.5" data-tooltip="${game.i18n.localize("CO.ui.applyHalfDamage")}" data-tooltip-direction="DOWN">x&frac12;</button>
            <button type="button" class="multiplier-btn ${effectiveMultiplier === 1 ? "active" : ""}" data-multiplier="1" data-tooltip="${game.i18n.localize("CO.ui.applyDamage")}" data-tooltip-direction="DOWN">x1</button>
            <button type="button" class="multiplier-btn ${effectiveMultiplier === 2 ? "active" : ""}" data-multiplier="2" data-tooltip="${game.i18n.localize("CO.ui.applyDoubleDamage")}" data-tooltip-direction="DOWN">x2</button>
          </div>
        `
        li.appendChild(controlsLine)
      }

      ul.appendChild(li)
    }

    details.appendChild(ul)
    targetsSection.appendChild(details)
  }

  static getDefaultMultiplier(tr, halfDmgOnSave) {
    if (tr.isCritical) return 0
    if (tr.isSuccess) return halfDmgOnSave ? 0.5 : 0
    return 1
  }

  static computeDamageDisplay(total, multiplier, drChecked, targetDr) {
    if (multiplier === 0) return "0"
    let computed = Math.ceil(Math.abs(total * multiplier))
    if (drChecked) computed = Math.max(multiplier > 0 ? 1 : 0, computed - targetDr)
    return multiplier < 0 ? `+${computed}` : `-${computed}`
  }

  // ----------------------------------------------------------------
  //  Multi-cible : listeners
  // ----------------------------------------------------------------

  _addMultiTargetListeners(html) {
    const hasDmg = this.hasDmg
    const dmgTotal = this.dmgTotal ?? 0

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

        // Si pas de DM, appliquer les effets immédiatement (comportement legacy)
        if (!hasDmg) {
          await SaveRollHandler.applyEffects({
            customEffect: message.system.customEffect,
            additionalEffect: message.system.additionalEffect,
            result: resolved.rollResult,
            targetActor,
          })
        }

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
        await SaveRollHandler.spendSaverLuckyPoint({ saverActor, message, targetUuid, deferEffects: hasDmg })
      })
    })

    // --- Listeners DM : multiplicateurs, DR, bouton Appliquer ---
    if (hasDmg && ((game.settings.get("co2", "allowPlayersToModifyTargets") && this.parent.isAuthor) || game.user.isGM)) {
      // Boutons multiplicateurs (ligne 2) — met à jour l'affichage DM (ligne 1)
      html.querySelectorAll(".save-target-dmg-row .multiplier-btn").forEach((btn) => {
        btn.addEventListener("click", (event) => {
          event.preventDefault()
          const controlsRow = btn.closest(".save-target-dmg-row")
          const targetRow = controlsRow.closest(".target-row")
          controlsRow.querySelectorAll(".multiplier-btn").forEach((b) => b.classList.remove("active"))
          btn.classList.add("active")
          const multiplier = parseFloat(btn.dataset.multiplier)
          const drCheckbox = controlsRow.querySelector(".target-dr")
          const drChecked = drCheckbox?.checked ?? true
          const targetDr = parseInt(controlsRow.dataset.targetDr) || 0
          const dmgDisplay = targetRow.querySelector(".target-damage")
          if (dmgDisplay) {
            dmgDisplay.textContent = SaveMessageData.computeDamageDisplay(dmgTotal, multiplier, drChecked, targetDr)
            dmgDisplay.dataset.multiplier = multiplier
          }
        })
      })

      // Checkboxes RD (ligne 2) — met à jour l'affichage DM (ligne 1)
      html.querySelectorAll(".save-target-dmg-row .target-dr").forEach((checkbox) => {
        checkbox.addEventListener("change", () => {
          const controlsRow = checkbox.closest(".save-target-dmg-row")
          const targetRow = controlsRow.closest(".target-row")
          const activeBtn = controlsRow.querySelector(".multiplier-btn.active")
          const multiplier = activeBtn ? parseFloat(activeBtn.dataset.multiplier) : 1
          const targetDr = parseInt(controlsRow.dataset.targetDr) || 0
          const dmgDisplay = targetRow.querySelector(".target-damage")
          if (dmgDisplay) {
            dmgDisplay.textContent = SaveMessageData.computeDamageDisplay(dmgTotal, multiplier, checkbox.checked, targetDr)
          }
        })
      })

      // Checkbox DM temporaires
      const tempDmCheckbox = html.querySelector("#saveTempDm")
      if (tempDmCheckbox) {
        tempDmCheckbox.addEventListener("change", async () => {
          const message = this.parent
          if (game.user.isGM) {
            await message.update({ "system.appliedTempDamage": tempDmCheckbox.checked })
          }
        })
      }

      // Bouton Appliquer unique
      const applyBtn = html.querySelector(".save-apply-btn")
      if (applyBtn) {
        applyBtn.addEventListener("click", async (event) => {
          event.preventDefault()
          const message = this.parent
          const tempDamage = html.querySelector("#saveTempDm")?.checked ?? false
          const actorId = html.querySelector(".save-card")?.dataset.actorId
          const flavor = html.querySelector(".card-item-name")?.textContent || ""

          const dmgRows = html.querySelectorAll(".save-target-dmg-row")
          for (const row of dmgRows) {
            const targetUuid = row.dataset.targetUuid
            if (!targetUuid) continue
            const activeBtn = row.querySelector(".multiplier-btn.active")
            const multiplier = activeBtn ? parseFloat(activeBtn.dataset.multiplier) : 1
            if (multiplier === 0) continue

            let type
            if (multiplier === 2) type = "double"
            else if (multiplier === 0.5) type = "half"
            else if (multiplier < 0) type = "heal"
            else type = "full"

            const drCheckbox = row.querySelector(".target-dr")
            const drChecked = drCheckbox?.checked ?? true

            const targetActor = fromUuidSync(targetUuid)
            if (targetActor) {
              await Hitpoints.applyToSingleTarget({ targetActor, fromActor: actorId, source: flavor, type, amount: dmgTotal, drChecked, tempDamage })
            }
          }

          // Application des effets supplémentaires (différée)
          const customEffect = message.system.customEffect
          const additionalEffect = message.system.additionalEffect
          if (customEffect && additionalEffect?.active && !message.system.effectsApplied) {
            const msgTargetResults = message.system.targetResults ?? []
            for (const tr of msgTargetResults) {
              if (tr.needsSaveRoll) continue
              const result = { isSuccess: tr.isSuccess, isFailure: tr.isFailure, isCritical: tr.isCritical, isFumble: tr.isFumble, total: tr.total }
              if (!Resolver.shouldManageAdditionalEffect(result, additionalEffect)) continue

              const targetActor = fromUuidSync(tr.uuid)
              if (targetActor) {
                if (game.user.isGM) await targetActor.applyCustomEffect(customEffect)
                else await game.users.activeGM.query("co2.applyCustomEffect", { ce: customEffect, targets: [targetActor.uuid] })
              }
            }
          }

          // Persistance des choix
          const targetResults = foundry.utils.deepClone(message.system.targetResults ?? [])
          for (const row of dmgRows) {
            const uuid = row.dataset.targetUuid
            const activeBtn = row.querySelector(".multiplier-btn.active")
            const mult = activeBtn ? parseFloat(activeBtn.dataset.multiplier) : 1
            const drCheckbox = row.querySelector(".target-dr")
            const drChecked = drCheckbox?.checked ?? true
            const tr = targetResults.find((t) => t.uuid === uuid)
            if (tr) {
              tr.appliedMultiplier = mult
              tr.appliedDrChecked = drChecked
            }
          }

          const updateData = {
            "system.targetResults": targetResults,
            "system.appliedTempDamage": tempDamage,
            "system.dmgApplied": true,
          }
          if (customEffect && additionalEffect?.active) updateData["system.effectsApplied"] = true

          if (game.user.isGM) {
            await message.update(updateData)
          } else {
            await game.users.activeGM.query("co2.updateMessageAfterSavedRoll", {
              existingMessageId: message.id,
              targetResults,
              dmgApplied: true,
              effectsApplied: customEffect && additionalEffect?.active ? true : undefined,
              appliedTempDamage: tempDamage,
            })
          }
        })
      }
    }

    // Interactions hover/click sur les lignes cibles (highlight token)
    const associatedActor = this.parent.getAssociatedActor?.()
    const canInteractWithTargets = game.user.isGM || this.parent.isAuthor || associatedActor?.isOwner
    let highlightedTargetToken = null
    const targetRows = html.querySelectorAll(".target-row[data-target-uuid]")
    targetRows.forEach((targetRow) => {
      if (!canInteractWithTargets) return

      targetRow.classList.add("is-interactive")

      targetRow.addEventListener("click", async (event) => {
        if (event.target.closest("button, a, .save-target-dmg-row")) return
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

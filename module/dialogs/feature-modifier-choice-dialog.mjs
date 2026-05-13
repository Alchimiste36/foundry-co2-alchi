import { SYSTEM } from "../config/system.mjs"

/**
 * Dialog permettant au joueur de choisir entre les modifiers optionnels d'un trait (peuple)
 * lors du drop sur la fiche personnage.
 */
export class CoFeatureModifierChoiceDialog {
  /**
   * @param {Object[]} modifiers - Les modifiers du trait (plain objects depuis toObject())
   * @returns {Promise<number[]|null>} Les indices des modifiers sélectionnés (incluant les non-optionnels), ou null si annulé
   */
  static async choose(modifiers) {
    const groups = this.#buildGroups(modifiers)
    if (Object.keys(groups).length === 0) return null

    const content = await foundry.applications.handlebars.renderTemplate(
      "systems/co2/templates/dialogs/feature-modifier-choice-dialog.hbs",
      { groups },
    )

    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize("CO.dialogs.featureModifierChoice.title") },
      position: { width: 450 },
      classes: ["co", "feature-modifier-choice-dialog"],
      content,
      rejectClose: false,
      buttons: [
        {
          action: "validate",
          label: game.i18n.localize("CO.dialogs.featureModifierChoice.validate"),
          icon: "fas fa-check",
          default: true,
          callback: (event, button, dialog) => {
            const selected = []
            for (const groupKey of Object.keys(groups)) {
              const radio = dialog.element.querySelector(`input[name="group-${groupKey}"]:checked`)
              if (radio) selected.push(parseInt(radio.value))
            }
            return selected
          },
        },
        {
          action: "cancel",
          label: game.i18n.localize("CO.dialogs.featureModifierChoice.cancel"),
          icon: "fas fa-xmark",
        },
      ],
    })

    if (!result || result === "cancel") return null

    const fixedIndices = modifiers.map((m, i) => (m.choiceGroup === 0 ? i : -1)).filter((i) => i >= 0)
    return [...fixedIndices, ...result]
  }

  /**
   * Regroupe les modifiers par choiceGroup et construit les données pour le template
   */
  static #buildGroups(modifiers) {
    const groups = {}
    const targets = SYSTEM.MODIFIERS_TARGET

    for (let i = 0; i < modifiers.length; i++) {
      const m = modifiers[i]
      if (m.choiceGroup === 0) continue

      const groupKey = m.choiceGroup
      if (!groups[groupKey]) {
        const groupConfig = SYSTEM.MODIFIERS.MODIFIERS_CHOICE_GROUP[groupKey]
        groups[groupKey] = {
          label: groupConfig ? game.i18n.localize(groupConfig.label) : `Choix ${groupKey}`,
          options: [],
        }
      }

      const targetConfig = targets[m.target]
      const targetLabel = targetConfig ? game.i18n.localize(targetConfig.label) : m.target

      groups[groupKey].options.push({
        index: i,
        value: m.value,
        targetLabel,
      })
    }

    return groups
  }
}

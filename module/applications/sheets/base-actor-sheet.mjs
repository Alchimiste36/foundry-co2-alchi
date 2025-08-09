const { sheets, ux } = foundry.applications
const { HandlebarsApplicationMixin } = foundry.applications.api
const { DragDrop } = foundry.applications.ux

import { SYSTEM } from "../../config/system.mjs"
import Utils from "../../utils.mjs"
import CoChat from "../../chat.mjs"
import slideToggle from "../../elements/slide-toggle.mjs"

export default class COBaseActorSheet extends HandlebarsApplicationMixin(sheets.ActorSheetV2) {
  /**
   * Different sheet modes.
   * @enum {number}
   */
  static SHEET_MODES = { EDIT: 0, PLAY: 1 }

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["co", "actor"],
    position: {
      width: 800,
      height: 900,
    },
    form: {
      submitOnChange: true,
    },
    window: {
      resizable: true,
    },
    actions: {
      editImage: COBaseActorSheet.#onEditImage,
      activateDef: COBaseActorSheet.#onActivateDef,
      deactivateDef: COBaseActorSheet.#onDeactivateDef,
      toggleSection: COBaseActorSheet.#onSectionToggle,
      changeSheetLock: COBaseActorSheet.#onSheetChangeLock,
      sendToChat: COBaseActorSheet.#onSendToChat,
      createItem: COBaseActorSheet.#onCreateItem,
      editItem: COBaseActorSheet.#onEditItem,
      learnCapacity: COBaseActorSheet.#onLearnCapacity,
      unlearnCapacity: COBaseActorSheet.#onUnlearnCapacity,
      deleteCustomEffect: COBaseActorSheet.#onDeleteCustomEffect,
      toggleAction: COBaseActorSheet.#onUseAction,
      toggleEffect: COBaseActorSheet.#onUseEffect,
    },
  }

  /**
   * The current sheet mode.
   * @type {number}
   */
  _sheetMode = this.constructor.SHEET_MODES.PLAY

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options)
    new DragDrop.implementation({
      dragSelector: ".draggable",
      permissions: {
        dragstart: this._canDragStart.bind(this),
        drop: this._canDragDrop.bind(this),
      },
      callbacks: {
        dragstart: this._onDragStart.bind(this),
        dragover: this._onDragOver.bind(this),
        drop: this._onDrop.bind(this),
      },
    }).bind(this.element)

    // Set toggle state and add status class to frame
    this._renderModeToggle(this.element)

    // Add onChange handler
    const selectSize = document.querySelector('select[data-action="sizeChange"]')
    if (selectSize) {
      selectSize.addEventListener("change", async (event) => {
        await this.constructor._onSizeChange.call(this, event, event.target)
      })
    }

    // Add right click handler to the image
    const img = this.element.querySelector(".resetImage")
    if (img) {
      img.addEventListener("contextmenu", async (event) => {
        event.preventDefault()
        await this.constructor._onResetImage.call(this, event, event.target)
      })
    }
  }

  /**
   * Is the sheet currently in 'Play' mode?
   * @type {boolean}
   */
  get isPlayMode() {
    return this._sheetMode === this.constructor.SHEET_MODES.PLAY
  }

  /**
   * Is the sheet currently in 'Edit' mode?
   * @type {boolean}
   */
  get isEditMode() {
    return this._sheetMode === this.constructor.SHEET_MODES.EDIT
  }

  /** @override */
  async _prepareContext() {
    const context = await super._prepareContext()

    context.debugMode = game.settings.get("co", "debugMode")
    context.fields = this.document.schema.fields
    context.systemFields = this.document.system.schema.fields
    context.systemSource = this.document.system._source
    context.actor = this.document
    context.system = this.document.system
    context.source = this.document.toObject()

    context.isCharacter = this.document.type === "character"

    context.abilities = this.document.system.abilities
    context.combat = this.document.system.combat
    context.attributes = this.document.system.attributes
    context.resources = this.document.system.resources
    context.details = this.document.system.details
    context.paths = this.document.paths
    context.pathGroups = await this.document.getPathGroups()
    context.capacities = this.document.capacities
    context.learnedCapacities = this.document.learnedCapacities
    context.capacitiesOffPaths = this.document.capacitiesOffPaths
    // Récupération du statut expanded depuis le localStorage
    let offPathsExpanded = true
    try {
      const key = `co-${this.document.id}-paths-capacitiesOffPaths`
      const stored = localStorage.getItem(key)
      if (stored !== null) {
        const parsedData = JSON.parse(stored)
        offPathsExpanded = parsedData.expanded === true
      }
    } catch (e) {
      offPathsExpanded = true
    }
    context.capacitiesOffPathsExpanded = offPathsExpanded
    context.features = this.document.features
    context.actions = this.document.actions
    context.inventory = this.document.inventory
    // Récupération du statut expanded depuis le localStorage
    let currenciesExpanded = true
    try {
      const key = `co-${this.document.id}-currencies`
      const stored = localStorage.getItem(key)
      if (stored !== null) {
        const parsedData = JSON.parse(stored)
        currenciesExpanded = parsedData.expanded === true
      }
    } catch (e) {
      currenciesExpanded = true
    }
    context.currenciesExpanded = currenciesExpanded
    context.unlocked = this.isEditMode
    context.locked = this.isPlayMode

    context.visibleActions = await this.document.getVisibleActions()
    context.visibleActivableActions = await this.document.getVisibleActivableActions()
    context.visibleNonActivableActions = await this.document.getVisibleNonActivableActions()
    context.visibleActivableTemporaireActions = await this.document.getVisibleActivableTemporaireActions()
    context.visibleNonActivableNonTemporaireActions = await this.document.getVisibleNonActivableNonTemporaireActions()
    context.currentEffects = await this.document.customEffects

    let states = []
    // Récupération des modifiers de type state
    this.document.system.stateModifiers.forEach((state) => {
      states.push(game.i18n.localize(`CO.label.long.${state.target}`))
    })
    // Récupération des statusEffects
    this.document.effects.forEach((effect) => {
      states.push(effect.name)
    })
    context.stateModifiers = states

    // Select options
    context.choiceMoveUnit = SYSTEM.MOVEMENT_UNIT

    if (CONFIG.debug.co?.sheets) console.debug(Utils.log(`CoBaseActorSheet - context`), context)
    return context
  }

  /**
   * Action d'utiliser : active ou désactive une action
   * @param {PointerEvent} event The originating click event
   * @param {HTMLElement} target The capturing HTML element which defined a [data-action]
   */
  static async #onUseAction(event, target) {
    event.preventDefault()
    const shiftKey = !!event.shiftKey
    const dataset = target.dataset
    const action = dataset.actionType
    const type = dataset.type
    const source = dataset.source
    const indice = dataset.indice

    let activation
    if (action === "activate") {
      activation = await this.document.activateAction({ state: true, source, indice, type, shiftKey })
    } else if (action === "unactivate") {
      activation = await this.document.activateAction({ state: false, source, indice, type })
    }
  }

  /**
   * Action d'utiliser un effet
   * @param {PointerEvent} event The originating click event
   * @param {HTMLElement} target The capturing HTML element which defined a [data-action]
   */
  static async #onUseEffect(event, target) {
    event.preventDefault()
    const dataset = target.dataset
    const effectid = dataset.effect
    const action = dataset.action
    let activation = false
    if (action === "activate") {
      activation = this.actor.activateCOStatusEffect({ state: true, effectid })
    } else if (action === "unactivate") {
      activation = this.actor.activateCOStatusEffect({ state: false, effectid })
    }
  }

  /**
   * Handles the toggle action for a section.
   * Prevents the default event action, finds the next foldable section,
   * and toggles its visibility with a sliding animation.
   *
   * @param {PointerEvent} event The originating click event
   * @param {HTMLElement} target The capturing HTML element which defined a [data-action]
   * @returns {boolean}
   */
  static #onSectionToggle(event, target) {
    event.preventDefault()
    const toggleType = target.dataset.toggleType
    const pathSlug = target.dataset.slug
    // Inventaire et voies
    let li = target.closest("li.items-container-header")
    let foldable
    if (li) foldable = li.nextElementSibling
    // Biographie
    else foldable = target.closest(".form-header").nextElementSibling
    while (foldable && !foldable.classList.contains("foldable")) {
      foldable = foldable.nextElementSibling
    }
    if (foldable) {
      // Change value in local storage to remember the state
      try {
        let key
        if (toggleType === "paths") {
          key = `co-${this.document.id}-${toggleType}-${pathSlug}`
        } else {
          key = `co-${this.document.id}-${toggleType}`
        }
        let stored = localStorage.getItem(key)
        if (stored !== null) {
          let value = JSON.parse(stored)
          value.expanded = !value.expanded
          localStorage.setItem(key, JSON.stringify(value))
        } else {
          // Créer une nouvelle entrée si elle n'existe pas
          localStorage.setItem(key, JSON.stringify({ expanded: true }))
        }
      } catch (e) {
        console.error(Utils.log(`CoBaseActorSheet - Error updating localStorage for path slug ${pathSlug}`), e)
      }
      slideToggle(foldable)
    }
    return true
  }

  /**
   * Manage the lock/unlock button on the sheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @param {COBaseActorSheet} sheet The sheet instance
   */
  static async #onSheetChangeLock(event, target) {
    event.preventDefault()
    const modes = sheet.constructor.SHEET_MODES
    this._sheetMode = this.isEditMode ? modes.PLAY : modes.EDIT
    this.render()
  }

  /**
   * Send the item details to the chat
   * Chat Type are :
   * - item : to display an item and all its actions
   * - action : to display the item and the action
   * - loot : to only display informations on the item
   * @param {PointerEvent} event The originating click event
   * @param {HTMLElement} target The capturing HTML element which defined a [data-action]
   */
  static async #onSendToChat(event, target) {
    event.preventDefault()
    // Dataset has tooltip, chatType and if it's an action there are also indice and source
    const dataset = target.dataset
    const chatType = dataset.chatType

    let item
    let id
    let indice = null
    if (chatType === "item" || chatType === "loot") {
      id = target.closest(".item").dataset.itemId
      item = this.actor.items.get(id)
    } else if (chatType === "action") {
      const { id } = foundry.utils.parseUuid(dataset.source)
      item = this.actor.items.get(id)
      indice = dataset.indice
    }

    let itemChatData = item.getChatData(item, this.actor, chatType, indice)

    await new CoChat(this.actor)
      .withTemplate("systems/co/templates/chat/item-card.hbs")
      .withData({
        actorId: this.actor.id,
        id: itemChatData.id,
        uuid: itemChatData.uuid,
        name: itemChatData.name,
        img: itemChatData.img,
        description: itemChatData.description,
        actions: itemChatData.actions,
      })
      .withWhisper(ChatMessage.getWhisperRecipients("GM").map((u) => u.id))
      .create()
  }

  /**
   * Create a new embedded item
   * @param {PointerEvent} event The originating click event
   * @param {HTMLElement} target The capturing HTML element which defined a [data-action]
   */
  static #onCreateItem(event, target) {
    event.preventDefault()
    const type = target.dataset.type

    const itemData = {
      type: type,
      system: foundry.utils.expandObject({ ...target.dataset }),
    }
    delete itemData.system.type

    switch (type) {
      case SYSTEM.ITEM_TYPE.equipment.id:
        itemData.name = game.i18n.format("CO.ui.newItem", { item: "Equipement" })
        let subtype
        switch (itemData.system.subtype) {
          case "armor":
            subtype = SYSTEM.EQUIPMENT_SUBTYPES.armor.id
            break
          case "shield":
            subtype = SYSTEM.EQUIPMENT_SUBTYPES.shield.id
            break
          case "weapon":
            subtype = SYSTEM.EQUIPMENT_SUBTYPES.weapon.id
            break
          case "consumable":
            subtype = SYSTEM.EQUIPMENT_SUBTYPES.consumable.id
            break
          case "misc":
            subtype = SYSTEM.EQUIPMENT_SUBTYPES.misc.id
            break
        }
        itemData.system.subtype = subtype
        break
      case SYSTEM.ITEM_TYPE.capacity.id:
        itemData.name = game.i18n.format("CO.ui.newItem", { item: "Capacité" })
        itemData.system.learned = true
        break
      case SYSTEM.ITEM_TYPE.attack.id:
        itemData.name = game.i18n.format("CO.ui.newItem", { item: "Attaque" })
        itemData.system.subtype = "MELEE"
        itemData.system.learned = true
        break
    }

    return this.actor.createEmbeddedDocuments("Item", [itemData])
  }

  /**
   * Change la taille du prototypeToken en fonction du choix de la taille
   *
   * @param {PointerEvent} event The originating change event
   * @param {HTMLElement} target The capturing HTML element which defined a [data-action]
   * @returns {Promise<void>} A promise that resolves when the actor's size has been updated.
   */
  static async _onSizeChange(event, target) {
    await this.actor.updateSize(event.target.value)
  }

  /**
   * Resets the actor's image and the prototype token to the default icon based on actor type.
   *
   * @param {Event} event The event triggered by the user action.
   * @param {HTMLElement} target The target element of the event.
   * @returns {Promise<void>} Resolves when the actor's image has been updated.
   */
  static async _onResetImage(event, target) {
    event.preventDefault()
    if (SYSTEM.ACTOR_ICONS[this.actor.type]) {
      const imgPath = SYSTEM.ACTOR_ICONS[this.actor.type]
      if (imgPath) {
        await this.document.update({ img: imgPath, "prototypeToken.texture.src": imgPath })
      }
    }
  }

  /**
   * Open the embedded item sheet
   * @param {PointerEvent} event The originating click event
   * @param {HTMLElement} target The capturing HTML element which defined a [data-action]
   */
  static #onEditItem(event, target) {
    event.preventDefault()
    const uuid = target.closest(".item").dataset.itemUuid
    if (uuid) {
      const { id } = foundry.utils.parseUuid(uuid)
      if (id) {
        const document = this.actor.items.get(id)
        if (document) return document.sheet.render(true)
      }
    }
  }

  /**
   * Handles the event when a capacity is learned.
   *
   * @param {PointerEvent} event The originating click event
   * @param {HTMLElement} target The capturing HTML element which defined a [data-action]
   * @returns {Promise<void>} A promise that resolves when the capacity has been marked as learned.
   */
  static async #onLearnCapacity(event, target) {
    event.preventDefault()
    const capacityId = target.closest(".item").dataset.itemId
    if (capacityId) await this.actor.toggleCapacityLearned(capacityId, true)
  }

  /**
   * Handles the event when a capacity is unlearned by the actor.
   *
   * @param {PointerEvent} event The originating click event
   * @param {HTMLElement} target The capturing HTML element which defined a [data-action]
   * @returns {Promise<void>} A promise that resolves when the capacity has been unlearned.
   */
  static async #onUnlearnCapacity(event, target) {
    event.preventDefault()
    const capacityId = target.closest(".item").dataset.itemId
    if (capacityId) await this.actor.toggleCapacityLearned(capacityId, false)
  }

  /**
   * Permet la suppression d'un effet personnalisé à la main au cas où il ne se terminerait pas de lui-même
   * Ou pour simuler un arrêt précoce à cause d'un sort de soin par exemple
   * @param {PointerEvent} event The originating click event
   * @param {HTMLElement} target The capturing HTML element which defined a [data-action]
   */
  static async #onDeleteCustomEffect(event, target) {
    event.preventDefault()
    let effectname = target.dataset.ceName

    const ce = this.actor.system.currentEffects.find((ce) => ce.slug === effectname)
    if (ce) {
      await this.actor.deleteCustomEffect(ce)
    }
  }

  /**
   * Handle changing a Document's image.
   *
   * @this COBaseActorSheet
   * @param {PointerEvent} event   The originating click event
   * @param {HTMLElement} target   The capturing HTML element which defined a [data-action]
   * @returns {Promise}
   * @private
   */
  static async #onEditImage(event, target) {
    const current = foundry.utils.getProperty(this.document, "img")
    const { img } = this.document.constructor.getDefaultArtwork?.(this.document.toObject()) ?? {}
    const fp = new foundry.applications.apps.FilePicker.implementation({
      current,
      type: "image",
      redirectToRoot: img ? [img] : [],
      callback: (path) => {
        this.document.update({ img: path })
      },
      top: this.position.top + 40,
      left: this.position.left + 10,
    })
    return fp.browse()
  }

  static async #onActivateDef(event, target) {
    const effect = target.dataset.effect
    this._handleDef(effect, true)
  }

  static async #onDeactivateDef(event, target) {
    const effect = target.dataset.effect
    this._handleDef(effect, false)
  }

  async _handleDef(effect, state) {
    // On ne peut pas activer à la fois la défense partielle et la défense totale
    if (effect === "partialDef" && state) {
      if (this.actor.hasEffect("fullDef")) {
        return ui.notifications.warn(game.i18n.localize("CO.notif.cantUseAllDef"))
      }
    }
    if (effect === "fullDef" && state) {
      if (this.actor.hasEffect("partialDef")) {
        return ui.notifications.warn(game.i18n.localize("CO.notif.cantUseAllDef"))
      }
    }

    const hasEffect = this.actor.statuses.has(effect)
    if (hasEffect && state === false) return await this.actor.toggleStatusEffect(effect, state)
    if (!hasEffect && state === true) return await this.actor.toggleStatusEffect(effect, state)
  }

  // #region Drag-and-Drop Workflow

  /** @inheritDoc */
  _onDragStart(event) {
    super._onDragStart(event)
  }

  // #endregion

  /**
   * Manage the lock/unlock button on the sheet
   * @param {Event} event
   */
  async _onSheetChangeLock(event) {
    event.preventDefault()
    const modes = this.constructor.SHEET_MODES
    this._sheetMode = this.isEditMode ? modes.PLAY : modes.EDIT
    await this.submit()
    this.render()
  }

  /**
   * Handle re-rendering the mode toggle on ownership changes.
   * @param {HTMLElement} element
   * @protected
   */
  _renderModeToggle(element) {
    const header = element.querySelector(".window-header")
    const toggle = header.querySelector(".mode-slider")
    if (this.isEditable && !toggle) {
      const toggle = document.createElement("co-toggle-switch")
      toggle.checked = this._sheetMode === this.constructor.SHEET_MODES.EDIT
      toggle.classList.add("mode-slider")
      // TODO change tooltip with translation
      toggle.dataset.tooltip = "CO.SheetModeEdit"
      toggle.setAttribute("aria-label", game.i18n.localize("CO.SheetModeEdit"))
      toggle.addEventListener("change", this._onSheetChangeLock.bind(this))
      toggle.addEventListener("dblclick", (event) => event.stopPropagation())
      toggle.addEventListener("pointerdown", (event) => event.stopPropagation())
      header.prepend(toggle)
    } else if (this.isEditable) {
      toggle.checked = this._sheetMode === this.constructor.SHEET_MODES.EDIT
    } else if (!this.isEditable && toggle) {
      toggle.remove()
    }
  }
}

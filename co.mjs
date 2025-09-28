// Configuration
import { SYSTEM } from "./module/config/system.mjs"

// Import modules
import * as models from "./module/models/_module.mjs"
import * as documents from "./module/documents/_module.mjs"
import * as applications from "./module/applications/_module.mjs"

// Helpers
import registerHandlebarsHelpers from "./module/helpers.mjs"
import registerSystemSettings from "./module/settings.mjs"
import registerHooks from "./module/hooks.mjs"
import Macros from "./module/macros.mjs"
import Utils from "./module/utils.mjs"
import { handleSocketEvent } from "./module/socket.mjs"

export * as elements from "./module/elements/_module.mjs"

globalThis.SYSTEM = SYSTEM

Hooks.once("init", async function () {
  console.info(SYSTEM.ASCII)
  console.info(Utils.log("Initializing..."))

  globalThis.cof = game.system
  game.system.CONST = SYSTEM

  // Expose the system API
  game.system.api = {
    applications,
    models,
    documents,
    macros: Macros,
  }

  // Actor
  CONFIG.Actor.documentClass = documents.COActor

  CONFIG.Actor.dataModels = {
    character: models.CharacterData,
    encounter: models.EncounterData,
  }

  foundry.documents.collections.Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet)
  foundry.documents.collections.Actors.registerSheet(SYSTEM.ID, applications.CharacterSheet, { types: ["character"], makeDefault: true, label: "CO.sheet.character" })
  foundry.documents.collections.Actors.registerSheet(SYSTEM.ID, applications.EncounterSheet, { types: ["encounter"], makeDefault: true, label: "CO.sheet.encounter" })

  // Item
  CONFIG.Item.documentClass = documents.COItem

  CONFIG.Item.dataModels = {
    capacity: models.CapacityData,
    equipment: models.EquipmentData,
    feature: models.FeatureData,
    profile: models.ProfileData,
    path: models.PathData,
    attack: models.AttackData,
  }

  foundry.documents.collections.Items.unregisterSheet("core", foundry.appv1.sheets.ItemSheet)
  foundry.documents.collections.Items.registerSheet(SYSTEM.ID, applications.AttackSheet, { types: ["attack"], makeDefault: true, label: "CO.sheet.attack" })
  foundry.documents.collections.Items.registerSheet(SYSTEM.ID, applications.CapacitySheet, { types: ["capacity"], makeDefault: true, label: "CO.sheet.capacity" })
  foundry.documents.collections.Items.registerSheet(SYSTEM.ID, applications.EquipmentSheet, { types: ["equipment"], makeDefault: true, label: "CO.sheet.equipment" })
  foundry.documents.collections.Items.registerSheet(SYSTEM.ID, applications.FeatureSheet, { types: ["feature"], makeDefault: true, label: "CO.sheet.feature" })
  foundry.documents.collections.Items.registerSheet(SYSTEM.ID, applications.PathSheet, { types: ["path"], makeDefault: true, label: "CO.sheet.path" })
  foundry.documents.collections.Items.registerSheet(SYSTEM.ID, applications.ProfileSheet, { types: ["profile"], makeDefault: true, label: "CO.sheet.profile" })

  // Chat
  CONFIG.ChatMessage.documentClass = documents.COChatMessage

  CONFIG.ChatMessage.dataModels = {
    base: models.BaseMessageData,
    action: models.ActionMessageData,
    item: models.ItemMessageData,
    skill: models.SkillMessageData,
  }

  // Status Effects
  CONFIG.statusEffects = SYSTEM.STATUS_EFFECT

  // Dice system configuration
  CONFIG.Dice.rolls.push(documents.CORoll, documents.COSkillRoll, documents.COAttackRoll)

  // Activate socket handler
  game.socket.on(`system.${SYSTEM.ID}`, handleSocketEvent)

  registerHandlebarsHelpers()
  registerSystemSettings()
  registerHooks()

  // Load Martial Training
  if (!game.system.CONST.martialTrainingsWeapons) {
    game.system.CONST.martialTrainingsWeapons = []
  }
  if (!game.system.CONST.martialTrainingsArmors) {
    game.system.CONST.martialTrainingsArmors = []
  }
  if (!game.system.CONST.martialTrainingsShields) {
    game.system.CONST.martialTrainingsShields = []
  }

  // Combat tracker
  if (game.settings.get("co", "usevarInit")) {
    CONFIG.Combat.initiative = {
      formula: "1d6x + @combat.init.value",
      decimals: 0,
    }
  } else {
    CONFIG.Combat.initiative = {
      formula: "@combat.init.value",
      decimals: 0,
    }
  }
  CONFIG.Combat.documentClass = documents.CombatCO
  // Un round dure 6s
  CONFIG.time.roundTime = 6

  // Add a custom sidebar tab
  CONFIG.ui.sidebar.TABS.co = {
    active: false,
    icon: `co`,
    tooltip: `Chroniques Oubliées`,
  }
  CONFIG.ui.co = applications.COSidebarMenu

  console.info(Utils.log("Initialized"))
})

Hooks.once("i18nInit", function () {
  // Traduction du tableau des conditions
  const customeffects = CONFIG.statusEffects.map((element) => {
    return {
      ...element,
      name: game.i18n.localize(element.name),
      description: game.i18n.localize(element.description),
    }
  })

  customeffects.sort((a, b) => a.name.localeCompare(b.name))
  CONFIG.statusEffects = customeffects
})

/**
 * Register world usage statistics
 * @param {string} registerKey
 */
function registerWorldCount(registerKey) {
  if (game.user.isGM) {
    let worldKey = game.settings.get(registerKey, "worldKey")
    if (worldKey === undefined || worldKey === "") {
      worldKey = foundry.utils.randomID(32)
      game.settings.set(registerKey, "worldKey", worldKey)
    }

    // Simple API counter
    const worldData = {
      register_key: registerKey,
      world_key: worldKey,
      foundry_version: `${game.release.generation}.${game.release.build}`,
      system_name: game.system.id,
      system_version: game.system.version,
    }

    let apiURL = "https://worlds.qawstats.info/worlds-counter"
    $.ajax({
      url: apiURL,
      type: "POST",
      data: JSON.stringify(worldData),
      contentType: "application/json; charset=utf-8",
      dataType: "json",
      async: false,
    })
  }
}

Hooks.once("ready", async function () {
  if (!CONFIG.debug.co) {
    if (game.settings.get("co", "debugMode")) {
      CONFIG.debug.co = {
        hooks: true,
        resolvers: true,
        rolls: true,
        sheets: true,
        actions: true,
        chat: true,
      }
    } else
      CONFIG.debug.co = {
        hooks: false,
        resolvers: false,
        rolls: false,
        sheets: false,
        actions: false,
        chat: false,
      }
  }

  // Statistics
  registerWorldCount("co")

  console.info(Utils.log(game.i18n.localize("CO.notif.ready")))
})

/*:
 * @plugindesc (ROA) Chrono Engine Party AI (ABS) - Followers/Party Battlers AI skeleton (RANGED/MELEE/TANK/HEALER). v0.1
 * @author dijOTTER
 *
 * @help
 * ============================================================================
 * ROA_ChronoPartyAI.js  (SKELETON)
 * ============================================================================
 * PURPOSE
 * - Adds AI-controlled party members for Chrono Engine ABS (Moghunter).
 * - Roles: RANGED, MELEE, TANK, HEALER (heals/buffs at range, defends in melee).
 *
 * WHAT YOU MUST WIRE (TODO)
 * - ChronoCompat.tryUseTool(...) must call Chrono's real tool execution path
 *   (commonly Game_Player.prototype.act() or a related method).
 * - If your Chrono build represents actor battlers as something other than followers,
 *   you may need to bind actorId -> map character differently in ChronoCompat.
 *
 * NOTETAGS (Actors)
 * <ChronoAI: true>
 * <ChronoAI Role: RANGED|MELEE|TANK|HEALER>
 * <ChronoAI Stance: Aggressive|Defensive|Hold>        (optional)
 * <ChronoAI Aggro: 6>                                 (optional tiles)
 * <ChronoAI Leash: 10>                                (optional tiles)
 * <ChronoAI PreferredRange: 4>                        (optional tiles)
 * <ChronoAI KeepDistance: 4>                          (optional tiles, ranged/healer)
 * <ChronoAI ProtectRadius: 5>                         (optional tiles, tank)
 *
 * TOOL IDs (these are Chrono "Tool Id" references, not skill ids)
 * <ChronoAI ToolAttack: 5>
 * <ChronoAI ToolDefend: 9>                            (optional, melee/healer defense)
 * <ChronoAI ToolHeal: 12>                             (healer)
 * <ChronoAI ToolBuff: 13>                             (healer)
 *
 * ENEMY TYPE (Enemies in database)
 * <ChronoAI EnemyType: RANGED|MELEE>
 *
 * NOTES
 * - This plugin parses enemy_id from event comments if present (Chrono style).
 * - Support skills (heal/buff) are applied via Game_Action by default (stable),
 *   while still triggering Chrono visuals via tool usage (optional).
 *
 * ============================================================================
 * @param Enabled
 * @type boolean
 * @default true
 *
 * @param Debug
 * @type boolean
 * @default false
 *
 * @param ThinkInterval
 * @type number
 * @min 1
 * @default 8
 * @desc AI "think" interval in frames per controller (lower = smarter, higher = faster).
 *
 * @param EnemyScanInterval
 * @type number
 * @min 1
 * @default 15
 *
 * @param DefaultAggro
 * @type number
 * @default 6
 *
 * @param DefaultLeash
 * @type number
 * @default 10
 *
 * @param DefaultPreferredRange
 * @type number
 * @default 4
 *
 * @param DefaultKeepDistance
 * @type number
 * @default 4
 *
 * @param DefaultProtectRadius
 * @type number
 * @default 5
 *
 * @param HealerHealThreshold
 * @type number
 * @min 1
 * @max 99
 * @default 70
 * @desc Heal allies if HP% <= this (normal heal).
 *
 * @param HealerCriticalThreshold
 * @type number
 * @min 1
 * @max 99
 * @default 35
 * @desc Emergency heal if HP% <= this (interrupts buffs).
 *
 * @param HealerBuffWindowFrames
 * @type number
 * @min 1
 * @default 300
 * @desc "Start of combat" buff window duration in frames (60fps ~ 5s if 300).
 *
 * @param PartyBodyMode
 * @type select
 * @option followers
 * @option custom
 * @default followers
 * @desc followers = drive Game_Follower movement. custom = you bind actor -> char in ChronoCompat.
 *
 * ============================================================================
 */

(function() {
  "use strict";

  // ------------------------------------------------------------
  // Params
  // ------------------------------------------------------------
  const PLUGIN_NAME = "ROA_ChronoPartyAI";
  const P = PluginManager.parameters(PLUGIN_NAME);

  const CFG = {
    enabled: String(P.Enabled || "true") === "true",
    debug: String(P.Debug || "false") === "true",
    thinkInterval: Number(P.ThinkInterval || 8),
    enemyScanInterval: Number(P.EnemyScanInterval || 15),

    defaultAggro: Number(P.DefaultAggro || 6),
    defaultLeash: Number(P.DefaultLeash || 10),
    defaultPreferredRange: Number(P.DefaultPreferredRange || 4),
    defaultKeepDistance: Number(P.DefaultKeepDistance || 4),
    defaultProtectRadius: Number(P.DefaultProtectRadius || 5),

    healerHealThreshold: Number(P.HealerHealThreshold || 70),
    healerCriticalThreshold: Number(P.HealerCriticalThreshold || 35),
    healerBuffWindowFrames: Number(P.HealerBuffWindowFrames || 300),

    partyBodyMode: String(P.PartyBodyMode || "followers"),
  };

  const log = (...args) => { if (CFG.debug) console.log(`[${PLUGIN_NAME}]`, ...args); };

  // ------------------------------------------------------------
  // Namespace
  // ------------------------------------------------------------
  window.ROA = window.ROA || {};
  ROA.ChronoPartyAI = ROA.ChronoPartyAI || {};

  // ------------------------------------------------------------
  // Notetag parsing helpers
  // ------------------------------------------------------------
  function parseTagValue(note, tagName) {
    // <ChronoAI Foo: Bar>
    const re = new RegExp(`<\\s*ChronoAI\\s+${tagName}\\s*:\\s*([^>]+)\\s*>`, "i");
    const m = note.match(re);
    return m ? String(m[1]).trim() : null;
  }

  function parseTagBool(note, tagName) {
    // <ChronoAI: true>
    const re = new RegExp(`<\\s*${tagName}\\s*:\\s*(true|false)\\s*>`, "i");
    const m = note.match(re);
    return m ? String(m[1]).toLowerCase() === "true" : null;
  }

  function actorAiConfig(actor) {
    const note = actor && actor.note ? actor.note : "";
    const enabled = parseTagBool(note, "ChronoAI") ?? false;
    const role = (parseTagValue(note, "Role") || "").toUpperCase();
    const stance = (parseTagValue(note, "Stance") || "AGGRESSIVE").toUpperCase();

    const cfg = {
      enabled,
      role: role || "MELEE",
      stance,
      aggro: Number(parseTagValue(note, "Aggro") || CFG.defaultAggro),
      leash: Number(parseTagValue(note, "Leash") || CFG.defaultLeash),
      preferredRange: Number(parseTagValue(note, "PreferredRange") || CFG.defaultPreferredRange),
      keepDistance: Number(parseTagValue(note, "KeepDistance") || CFG.defaultKeepDistance),
      protectRadius: Number(parseTagValue(note, "ProtectRadius") || CFG.defaultProtectRadius),

      toolAttack: Number(parseTagValue(note, "ToolAttack") || 0),
      toolDefend: Number(parseTagValue(note, "ToolDefend") || 0),
      toolHeal: Number(parseTagValue(note, "ToolHeal") || 0),
      toolBuff: Number(parseTagValue(note, "ToolBuff") || 0),
    };

    return cfg;
  }

  function enemyTypeFromEnemyDb(enemyId) {
    const e = $dataEnemies && $dataEnemies[enemyId];
    if (!e) return "MELEE";
    const note = e.note || "";
    const t = (parseTagValue(note, "EnemyType") || "MELEE").toUpperCase();
    return (t === "RANGED") ? "RANGED" : "MELEE";
  }

  // ------------------------------------------------------------
  // Chrono compatibility adapter (ONLY place to touch Chrono internals)
  // ------------------------------------------------------------
  const ChronoCompat = {
    // --- Actor -> map character binding ---
    characterForActorId(actorId) {
      if (CFG.partyBodyMode === "followers") {
        // follower index 1 = party slot 2, etc. (leader is player)
        const members = $gameParty.members();
        const idx = members.findIndex(a => a && a.actorId && a.actorId() === actorId);
        if (idx <= 0) return null;
        const follower = $gamePlayer.followers().follower(idx - 1);
        return follower || null;
      }

      // TODO: If your Chrono build spawns separate battler events for actors,
      // bind actorId -> that event/character here.
      return null;
    },

    // --- Enemy discovery ---
    ensureEnemyMetaCached() {
      // Cache enemy_id on events by scanning event comments once per map.
      $gameMap.events().forEach(ev => {
        if (!ev || ev._roaChronoEnemyMetaCached) return;
        ev._roaChronoEnemyMetaCached = true;

        const data = ev.event && ev.event();
        if (!data || !data.pages) return;

        let enemyId = 0;
        // Scan comments in all pages; first match wins.
        for (const page of data.pages) {
          if (!page || !page.list) continue;
          for (const cmd of page.list) {
            if (!cmd) continue;
            // 108 and 408 are comment codes in MV.
            if (cmd.code === 108 || cmd.code === 408) {
              const line = String(cmd.parameters[0] || "");
              // Chrono style: enemy_id : X  (docs)
              const m = line.match(/enemy_id\s*:\s*(\d+)/i);
              if (m) {
                enemyId = Number(m[1]);
                break;
              }
            }
          }
          if (enemyId) break;
        }

        if (enemyId > 0) {
          ev._roaEnemyId = enemyId;
          ev._roaEnemyType = enemyTypeFromEnemyDb(enemyId);
        }
      });
    },

    enemyCharacters() {
      this.ensureEnemyMetaCached();
      // Heuristic: any map event that has enemy_id comment is an enemy battler on map.
      return $gameMap.events().filter(ev => ev && ev._roaEnemyId > 0);
    },

    // --- Distance helpers ---
    distTiles(a, b) {
      if (!a || !b) return 9999;
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      return dx + dy; // manhattan is fine for steering
    },

    // --- Movement helpers ---
    moveToward(char, targetChar) {
      if (!char || !targetChar) return;
      char.moveTowardCharacter(targetChar);
    },

    moveAway(char, targetChar) {
      if (!char || !targetChar) return;
      char.moveAwayFromCharacter(targetChar);
    },

    // Simple "orbit" (side-step) to reduce kiting jitter
    sidestep(char, targetChar) {
      if (!char || !targetChar) return;
      const dx = targetChar.x - char.x;
      const dy = targetChar.y - char.y;
      // pick perpendicular direction
      if (Math.abs(dx) > Math.abs(dy)) {
        // target mostly left/right => sidestep up/down
        (Math.random() < 0.5) ? char.moveStraight(8) : char.moveStraight(2);
      } else {
        // target mostly up/down => sidestep left/right
        (Math.random() < 0.5) ? char.moveStraight(4) : char.moveStraight(6);
      }
    },

    // --- Tool usage ---
    tryUseTool(userChar, toolId, commandType) {
      // TODO: This is the MOST IMPORTANT wire-up.
      // You must trigger Chrono's REAL "use tool" pipeline here.
      //
      // Common Chrono setups use something like Game_Player.prototype.act()
      // to execute the currently selected tool, sometimes reading internal fields.
      //
      // This skeleton tries several call shapes. You may need to edit to match your Chrono version.
      if (!userChar || !toolId) return false;

      // 1) Preferred: direct act(toolId, commandType) if supported
      if (typeof userChar.act === "function") {
        try {
          // Attempt signatures:
          userChar._roaForcedToolId = toolId;       // stash for versions that read from vars
          userChar._roaForcedCmdType = commandType; // 0=weapon 1=skill 2=item (Chrono docs)
          // Try common variants:
          userChar.act(toolId, commandType);
          return true;
        } catch (e1) {
          try { userChar.act(toolId); return true; } catch (e2) {}
          try { userChar.act(); return true; } catch (e3) {}
          // fall through
        }
      }

      // 2) Fallback: if your Chrono exposes a global manager, call it here.
      // e.g., if (Moghunter && Moghunter.someMethod) { ... }
      // TODO: Implement per your Chrono internals.
      log("tryUseTool failed: no compatible act() found. Wire ChronoCompat.tryUseTool.");
      return false;
    },

    // --- Support effects (heal/buff) ---
    applySupportSkill(userActor, targetActor, skillId) {
      if (!userActor || !targetActor || !skillId) return false;
      const skill = $dataSkills && $dataSkills[skillId];
      if (!skill) return false;

      // Pay cost
      if (userActor.canPaySkillCost && !userActor.canPaySkillCost(skill)) return false;
      if (userActor.paySkillCost) userActor.paySkillCost(skill);

      // Apply action
      const action = new Game_Action(userActor);
      action.setSkill(skillId);
      action.apply(targetActor);

      // TODO: If you want Chrono-style popups/animations, trigger them here.
      // Example ideas:
      // - targetChar.requestAnimation(skill.animationId)
      // - call Chrono popup function if exposed

      return true;
    },
  };

  ROA.ChronoPartyAI.ChronoCompat = ChronoCompat;

  // ------------------------------------------------------------
  // Blackboard (shared caches)
  // ------------------------------------------------------------
  class Blackboard {
    constructor() {
      this._frame = 0;
      this._enemyScanCd = 0;
      this.enemies = [];
      this.combatActive = false;
      this.combatStartFrame = 0;
    }

    update() {
      this._frame++;

      if (this._enemyScanCd-- <= 0) {
        this._enemyScanCd = CFG.enemyScanInterval;
        this.enemies = ChronoCompat.enemyCharacters();
      }

      // Consider combat active if any enemy is within max aggro of player
      const p = $gamePlayer;
      let active = false;
      for (const e of this.enemies) {
        if (ChronoCompat.distTiles(p, e) <= CFG.defaultAggro) { active = true; break; }
      }

      if (active && !this.combatActive) {
        this.combatActive = true;
        this.combatStartFrame = this._frame;
      } else if (!active) {
        this.combatActive = false;
      }
    }
  }

  // ------------------------------------------------------------
  // Controller per actor
  // ------------------------------------------------------------
  const Roles = {
    RANGED: "RANGED",
    MELEE: "MELEE",
    TANK: "TANK",
    HEALER: "HEALER",
  };

  const Stances = {
    AGGRESSIVE: "AGGRESSIVE",
    DEFENSIVE: "DEFENSIVE",
    HOLD: "HOLD",
  };

  class Controller {
    constructor(actorId, cfg, blackboard) {
      this.actorId = actorId;
      this.cfg = cfg;
      this.bb = blackboard;

      this._thinkCd = Math.floor(Math.random() * CFG.thinkInterval);
      this._state = "FOLLOW";
      this._target = null;

      // healer combat script state
      this._buffedThisCombat = {};     // actorId -> true
      this._buffQueue = [];            // array actorIds in priority order
      this._combatStartFrameSeen = 0;  // to reset per combat
    }

    actor() { return $gameActors.actor(this.actorId); }
    char() { return ChronoCompat.characterForActorId(this.actorId); }

    role() {
      const r = String(this.cfg.role || "MELEE").toUpperCase();
      return Roles[r] ? r : Roles.MELEE;
    }

    update() {
      if (!CFG.enabled || !this.cfg.enabled) return;

      const ch = this.char();
      const ac = this.actor();
      if (!ch || !ac) return;

      if (this._thinkCd-- > 0) return;
      this._thinkCd = CFG.thinkInterval;

      // If leashed too far from player, recover
      const leashDist = this.cfg.leash;
      if (ChronoCompat.distTiles(ch, $gamePlayer) > leashDist) {
        this._state = "RECOVER";
        this._target = null;
      }

      // Healer combat-state reset
      if (!this.bb.combatActive) {
        this._buffedThisCombat = {};
        this._buffQueue = [];
        this._combatStartFrameSeen = 0;
      }

      switch (this._state) {
        case "FOLLOW": return this.thinkFollow();
        case "ACQUIRE": return this.thinkAcquire();
        case "ACT": return this.thinkAct();
        case "RECOVER": return this.thinkRecover();
        case "HOLD": return this.thinkHold();
        default:
          this._state = "FOLLOW";
          return;
      }
    }

    // -------------------------
    // States
    // -------------------------
    thinkFollow() {
      const stance = this.cfg.stance;
      if (stance === Stances.HOLD) {
        this._state = "HOLD";
        return;
      }

      // If combat active, acquire targets
      if (this.bb.combatActive) {
        this._state = "ACQUIRE";
        return;
      }

      // Stay near player
      const ch = this.char();
      const d = ChronoCompat.distTiles(ch, $gamePlayer);
      if (d > 2) ChronoCompat.moveToward(ch, $gamePlayer);
    }

    thinkHold() {
      // Hold position, but defend if enemy is close
      const ch = this.char();
      const enemies = this.bb.enemies;
      const close = enemies.find(e => ChronoCompat.distTiles(ch, e) <= 3);
      if (close) {
        this._target = close;
        this._state = "ACT";
      }
    }

    thinkRecover() {
      const ch = this.char();
      ChronoCompat.moveToward(ch, $gamePlayer);
      if (ChronoCompat.distTiles(ch, $gamePlayer) <= 3) {
        this._state = this.cfg.stance === Stances.HOLD ? "HOLD" : "FOLLOW";
      }
    }

    thinkAcquire() {
      const role = this.role();

      if (role === Roles.HEALER) {
        // healer can act even without enemy target (support)
        this._state = "ACT";
        return;
      }

      const t = this.pickTarget(role);
      if (!t) {
        this._state = this.cfg.stance === Stances.HOLD ? "HOLD" : "FOLLOW";
        return;
      }
      this._target = t;
      this._state = "ACT";
    }

    thinkAct() {
      const role = this.role();

      if (role === Roles.HEALER) return this.actHealer();
      if (role === Roles.RANGED) return this.actRanged();
      if (role === Roles.TANK) return this.actTank();
      return this.actMelee();
    }

    // -------------------------
    // Target picking
    // -------------------------
    pickTarget(role) {
      const ch = this.char();
      const enemies = this.bb.enemies;
      if (!enemies || enemies.length === 0) return null;

      // RANGED: prioritize ranged enemies first; else nearest
      if (role === Roles.RANGED) {
        const ranged = enemies.filter(e => e._roaEnemyType === "RANGED");
        const pool = (ranged.length > 0) ? ranged : enemies;
        return this.nearestInPool(ch, pool);
      }

      // TANK/MELEE: default nearest (tank may override in actTank)
      return this.nearestInPool(ch, enemies);
    }

    nearestInPool(ch, pool) {
      let best = null;
      let bestD = 9999;
      for (const e of pool) {
        const d = ChronoCompat.distTiles(ch, e);
        if (d < bestD) { bestD = d; best = e; }
      }
      return best;
    }

    // -------------------------
    // Role actions
    // -------------------------
    actRanged() {
      const ch = this.char();
      const t = this._target || this.pickTarget(Roles.RANGED);
      if (!t) { this._state = "FOLLOW"; return; }

      const d = ChronoCompat.distTiles(ch, t);
      const keep = this.cfg.keepDistance;

      // Kite melee targets, hold vs ranged
      if (t._roaEnemyType === "MELEE" && d <= keep) {
        ChronoCompat.moveAway(ch, t);
        ChronoCompat.sidestep(ch, t);
      } else if (d > this.cfg.preferredRange) {
        ChronoCompat.moveToward(ch, t);
      }

      // Fire tool if we have it
      if (this.cfg.toolAttack > 0) {
        ChronoCompat.tryUseTool(ch, this.cfg.toolAttack, 0);
      }

      this._state = "ACQUIRE";
    }

    actMelee() {
      const ch = this.char();
      const t = this._target || this.pickTarget(Roles.MELEE);
      if (!t) { this._state = "FOLLOW"; return; }

      // pursue
      ChronoCompat.moveToward(ch, t);

      if (this.cfg.toolAttack > 0) {
        ChronoCompat.tryUseTool(ch, this.cfg.toolAttack, 0);
      }

      this._state = "ACQUIRE";
    }

    actTank() {
      const ch = this.char();
      const protectRadius = this.cfg.protectRadius;

      // Find the nearest protected ally (ranged + healer)
      const protectedActorIds = ROA.ChronoPartyAI.Manager.partyActorIds()
        .filter(id => {
          const a = $gameActors.actor(id);
          if (!a) return false;
          const c = actorAiConfig(a);
          const r = String(c.role || "MELEE").toUpperCase();
          return r === Roles.RANGED || r === Roles.HEALER;
        });

      let protectedChar = null;
      let bestD = 9999;
      for (const aid of protectedActorIds) {
        const pc = ChronoCompat.characterForActorId(aid);
        if (!pc) continue;
        const d = ChronoCompat.distTiles(ch, pc);
        if (d < bestD) { bestD = d; protectedChar = pc; }
      }

      // Pick an enemy close to protected ally first (peel), otherwise nearest enemy
      let t = null;
      if (protectedChar) {
        for (const e of this.bb.enemies) {
          if (ChronoCompat.distTiles(protectedChar, e) <= protectRadius) {
            t = e;
            break;
          }
        }
      }
      if (!t) t = this.pickTarget(Roles.TANK);
      if (!t) { this._state = "FOLLOW"; return; }

      ChronoCompat.moveToward(ch, t);

      if (this.cfg.toolAttack > 0) {
        ChronoCompat.tryUseTool(ch, this.cfg.toolAttack, 0);
      }

      this._state = "ACQUIRE";
    }

    actHealer() {
      const userActor = this.actor();
      const userChar = this.char();
      if (!userActor || !userChar) { this._state = "FOLLOW"; return; }

      // --- Determine combat window and initialize buff queue once per combat start
      if (this.bb.combatActive && this._combatStartFrameSeen !== this.bb.combatStartFrame) {
        this._combatStartFrameSeen = this.bb.combatStartFrame;
        this._buffedThisCombat = {};
        this._buffQueue = this.buildHealerBuffQueue();
      }

      // --- Emergency/normal heal checks
      const lowest = this.lowestHpAlly();
      const lowestHpPct = lowest ? lowest.hpPct : 999;

      const critical = CFG.healerCriticalThreshold;
      const healAt = CFG.healerHealThreshold;

      if (lowest && lowestHpPct <= critical) {
        this.doHealerHeal(lowest.actorId);
        this._state = "ACT";
        return;
      }

      if (lowest && lowestHpPct <= healAt) {
        this.doHealerHeal(lowest.actorId);
        this._state = "ACT";
        return;
      }

      // --- Start-of-combat buff script (player -> melee -> ranged), interrupted by heals above
      if (this.bb.combatActive) {
        const withinWindow = (this.bb._frame - this.bb.combatStartFrame) <= CFG.healerBuffWindowFrames;
        if (withinWindow) {
          const next = this._buffQueue.find(id => !this._buffedThisCombat[id]);
          if (next) {
            this.doHealerBuff(next);
            this._state = "ACT";
            return;
          }
        }
      }

      // --- No support needed: defend if threatened, otherwise reposition
      const closeEnemy = this.bb.enemies.find(e => ChronoCompat.distTiles(userChar, e) <= 2);
      if (closeEnemy) {
        // defend in melee
        if (this.cfg.toolDefend > 0) {
          ChronoCompat.tryUseTool(userChar, this.cfg.toolDefend, 0);
        } else if (this.cfg.toolAttack > 0) {
          ChronoCompat.tryUseTool(userChar, this.cfg.toolAttack, 0);
        } else {
          ChronoCompat.moveAway(userChar, closeEnemy);
        }
        this._state = "ACT";
        return;
      }

      // reposition behind player (simple)
      if (ChronoCompat.distTiles(userChar, $gamePlayer) > 3) {
        ChronoCompat.moveToward(userChar, $gamePlayer);
      }

      this._state = "ACQUIRE";
    }

    buildHealerBuffQueue() {
      const ids = ROA.ChronoPartyAI.Manager.partyActorIds();
      const leaderId = $gameParty.leader() ? $gameParty.leader().actorId() : 0;

      const melee = [];
      const ranged = [];
      const healer = [];

      for (const id of ids) {
        const a = $gameActors.actor(id);
        if (!a) continue;
        const c = actorAiConfig(a);
        const r = String(c.role || "MELEE").toUpperCase();
        if (r === Roles.HEALER) healer.push(id);
        else if (r === Roles.TANK || r === Roles.MELEE) melee.push(id);
        else ranged.push(id);
      }

      // Buff order: Player first, then melee, then ranged, then (optional) other healers.
      const q = [];
      if (leaderId) q.push(leaderId);
      q.push(...melee.filter(id => id !== leaderId));
      q.push(...ranged.filter(id => id !== leaderId));
      q.push(...healer.filter(id => id !== leaderId));
      return q;
    }

    lowestHpAlly() {
      const ids = ROA.ChronoPartyAI.Manager.partyActorIds();
      let best = null;

      for (const id of ids) {
        const a = $gameActors.actor(id);
        if (!a || a.isDead && a.isDead()) continue;
        const pct = a.hpRate ? (a.hpRate() * 100) : 100;
        if (!best || pct < best.hpPct) best = { actorId: id, hpPct: pct };
      }

      return best;
    }

    doHealerHeal(targetActorId) {
      if (!this.cfg.toolHeal && !this.cfg.toolAttack) return;

      const userChar = this.char();
      const targetChar = ChronoCompat.characterForActorId(targetActorId);
      const userActor = this.actor();
      const targetActor = $gameActors.actor(targetActorId);
      if (!userChar || !userActor || !targetActor) return;

      // Move into heal range
      const d = targetChar ? ChronoCompat.distTiles(userChar, targetChar) : 999;
      const range = this.cfg.preferredRange;
      if (targetChar && d > range) {
        ChronoCompat.moveToward(userChar, targetChar);
        return;
      }

      // 1) Optional: trigger Chrono heal tool for visuals/pose
      if (this.cfg.toolHeal > 0) {
        ChronoCompat.tryUseTool(userChar, this.cfg.toolHeal, 1);
      }

      // 2) Apply actual heal effect using a REAL skill id (recommended)
      // TODO: set the skill id you want tied to healing (could be the same skill referenced by tool event)
      // You can store it as another notetag later (e.g. <ChronoAI HealSkillId: 25>)
      // For now we assume your tool event's damage is driven by a skill, so you may choose to skip this.
      // Example:
      // ChronoCompat.applySupportSkill(userActor, targetActor, 25);

      log(`Healer ${this.actorId} heal -> ${targetActorId}`);
    }

    doHealerBuff(targetActorId) {
      if (!this.cfg.toolBuff) return;

      const userChar = this.char();
      const targetChar = ChronoCompat.characterForActorId(targetActorId);
      const userActor = this.actor();
      const targetActor = $gameActors.actor(targetActorId);
      if (!userChar || !userActor || !targetActor) return;

      const d = targetChar ? ChronoCompat.distTiles(userChar, targetChar) : 999;
      const range = this.cfg.preferredRange;
      if (targetChar && d > range) {
        ChronoCompat.moveToward(userChar, targetChar);
        return;
      }

      // Trigger Chrono buff tool for visuals/pose
      ChronoCompat.tryUseTool(userChar, this.cfg.toolBuff, 1);

      // Apply actual buff state via skill if desired
      // TODO: pick your buff skill id and apply it:
      // ChronoCompat.applySupportSkill(userActor, targetActor, 30);

      this._buffedThisCombat[targetActorId] = true;
      log(`Healer ${this.actorId} buff -> ${targetActorId}`);
    }
  }

  // ------------------------------------------------------------
  // Manager (singleton)
  // ------------------------------------------------------------
  class Manager {
    constructor() {
      this.bb = new Blackboard();
      this.controllers = new Map(); // actorId -> Controller
    }

    static get() {
      if (!ROA.ChronoPartyAI._mgr) ROA.ChronoPartyAI._mgr = new Manager();
      return ROA.ChronoPartyAI._mgr;
    }

    static partyActorIds() {
      return $gameParty.members().map(a => a.actorId());
    }

    sync() {
      if (!CFG.enabled) return;
      const ids = Manager.partyActorIds();

      // Create controllers for AI-enabled party members (excluding leader)
      const leaderId = $gameParty.leader() ? $gameParty.leader().actorId() : 0;

      for (const actorId of ids) {
        if (actorId === leaderId) continue;
        const actor = $gameActors.actor(actorId);
        if (!actor) continue;

        const cfg = actorAiConfig(actor);
        if (!cfg.enabled) {
          this.controllers.delete(actorId);
          continue;
        }

        if (!this.controllers.has(actorId)) {
          this.controllers.set(actorId, new Controller(actorId, cfg, this.bb));
          log("Controller created for actorId", actorId, cfg.role);
        } else {
          // refresh config each sync (so notetag tweaks take effect on reload)
          this.controllers.get(actorId).cfg = cfg;
        }
      }

      // Remove controllers for actors no longer in party
      for (const actorId of [...this.controllers.keys()]) {
        if (!ids.includes(actorId)) this.controllers.delete(actorId);
      }
    }

    update() {
      if (!CFG.enabled) return;

      this.bb.update();

      // Ensure controllers exist
      this.sync();

      // Update all controllers (they internally stagger on think interval)
      for (const c of this.controllers.values()) c.update();
    }
  }

  ROA.ChronoPartyAI.Manager = Manager;

  // ------------------------------------------------------------
  // Scene hooks
  // ------------------------------------------------------------
  const _Scene_Map_update = Scene_Map.prototype.update;
  Scene_Map.prototype.update = function() {
    _Scene_Map_update.call(this);
    if (CFG.enabled) Manager.get().update();
  };

  const _Game_Map_setup = Game_Map.prototype.setup;
  Game_Map.prototype.setup = function(mapId) {
    _Game_Map_setup.call(this, mapId);
    // refresh caches
    const mgr = Manager.get();
    mgr.bb = new Blackboard();
    mgr.controllers.clear();
    mgr.sync();
  };

  // ------------------------------------------------------------
  // Optional: stop default follower chasing if AI is enabled (followers mode)
  // ------------------------------------------------------------
  if (CFG.partyBodyMode === "followers") {
    const _Game_Follower_update = Game_Follower.prototype.update;
    Game_Follower.prototype.update = function() {
      // If this follower corresponds to an AI-controlled actor, we let AI movement drive it.
      const actor = this.actor ? this.actor() : null;
      const actorId = actor && actor.actorId ? actor.actorId() : 0;
      const cfg = actor ? actorAiConfig(actor) : null;

      if (CFG.enabled && cfg && cfg.enabled) {
        // Keep basic animation updates but avoid chaseCharacter pathing:
        this.updateMove();
        this.updateAnimation();
        this.updateDirection();
        this.updateBushDepth();
        this.updateStop();
        return;
      }

      _Game_Follower_update.call(this);
    };
  }

})();

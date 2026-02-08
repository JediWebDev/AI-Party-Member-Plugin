/*:
 * @plugindesc Compatibility bridge for ROA Party AI with MOG Chrono Engine.
 * @author
 *
 * @help
 * This plugin provides compatibility helpers for Chrono-based tool usage.
 */

var ROA = ROA || {};
ROA.ChronoPartyAI = ROA.ChronoPartyAI || {};

(function() {
  "use strict";

  ROA.ChronoPartyAI.PartyBodyMode = "custom";

  var ChronoCompat = ROA.ChronoPartyAI.ChronoCompat || {};

  ChronoCompat.tryUseTool = function(userCharacter, toolId) {
    if (!userCharacter || toolId == null) {
      return false;
    }

    if (typeof userCharacter.act === "function") {
      userCharacter.act(toolId);
      return true;
    }

    return false;
  };

  ChronoCompat.characterForActorId = function(actorId) {
    if (!$gameMap || typeof $gameMap.players !== "function") {
      return null;
    }

    var players = $gameMap.players();
    for (var i = 0; i < players.length; i++) {
      var character = players[i];
      if (!character || !character.battler || !character.battler()) {
        continue;
      }

      if (Number(character.battler()._actorId) === Number(actorId)) {
        return character;
      }
    }

    return null;
  };

  ROA.ChronoPartyAI.ChronoCompat = ChronoCompat;
})();

# Hull and Honor — Design Document

A single-player space trading, piracy and pirate-hunting game. You are a captain with one ship in a large, randomly generated galaxy. Every job you take changes who trusts you and who wants you dead.

## Core decisions (settled)

- **Single-player.** No multiplayer planned.
- **One ship.** You always control exactly one ship. You can upgrade it or replace it, but you never command a fleet.
- **Open sandbox.** No fixed main plot. Story arcs are triggered by your reputation and can overlap or collide.
- **Fairly deep, turn-based combat.**
- **Larger, randomly generated galaxy** that is new each campaign.
- **Losing your ship ≠ game over.** Insurance covers you (see Death and Loss).
- **Death = game over**, unless you reload a save.
- **Not an audio game.** A standard web page that plays well with VoiceOver on iPhone and with a screen reader (JAWS) on computer.

## Accessibility principles

- Plain HTML/JS. Real buttons, headings and lists, so screen reader navigation (headings, buttons) works naturally.
- Short, clear status updates in a live region. No repeated spoken instructions.
- Everything the player needs is available as text: numbers, lists and short descriptions. Nothing depends on seeing a map.
- The galaxy map is navigated as lists (systems, routes, distances), not by sight.

## Reputation

Reputation is the backbone of the game. Each faction tracks your standing separately, on a scale from Hated to Revered.

| Faction | Raised by | Lowered by |
|---|---|---|
| Merchant guilds | Honest trade, deliveries, escorts | Raiding merchant ships, failed deliveries |
| Navy / system authorities | Hunting pirates, patrols, bounties | Smuggling, getting caught, attacking lawful ships |
| Pirate clans | Raids, smuggling, fencing stolen cargo | Pirate hunting, turning pirates in |
| Individual ports/planets | Helping locals, local jobs | Crimes in that system |

- Ports remember you individually, so you can be a hero in one system and wanted in the next.
- **High standing** unlocks better contracts, discounts, rare ships and equipment, and faction story arcs.
- **Low standing** brings bounty hunters, closed ports, patrols that scan or attack on sight, and higher prices.
- **Notoriety** is a separate, hidden-ish measure of how well known you are. The more famous you are, the more you're noticed, by both allies and enemies.
- Rival factions react to each other: helping one can hurt your standing with another.

## Missions

| Type | What you do |
|---|---|
| Trade | Buy low, sell high; cargo deliveries with deadlines |
| Escort | Protect convoys or VIP ships |
| Patrol / anti-piracy | Clear pirates from a lane |
| Bounty | Hunt a named captain (pirate, or rival if you're a pirate) |
| Piracy | Intercept ships, then board, demand tribute or let them go |
| Smuggling | Carry illegal cargo past customs scans; bribes and risk |

- Missions are offered at ports (guild offices, navy posts, back-room contacts), and which ones appear depends on your reputation.
- Failing a mission costs reputation with whoever gave it.
- **Conflict missions:** some jobs force a choice between factions (for example, a pirate clan pays you to "lose" the convoy you're escorting).

## Story arcs (triggered by reputation)

- **Navy hero**: offered a commission; pulled into hunting the region's biggest pirate lord.
- **Pirate rise**: climb the clan ranks and eventually challenge for leadership.
- **Double agent**: high standing with both navy and pirates gets noticed, leading to blackmail or a chance to play both sides.
- **Guild favorite**: trade monopolies, large contracts, corporate intrigue.
- **Wanted**: hated everywhere; survive, and maybe clear your name.

Several arcs can be active in one campaign, and they can clash.

## Combat (turn-based, fairly deep)

- **Range bands:** Close, Medium, Long, Extreme. Each turn you close in, hold or pull away. Engine power and ship speed decide who controls the range.
- **Weapons suited to each range:** lasers strongest up close, cannons at medium, missiles at long range (missiles can be shot down by point defense).
- **Power allocation:** the reactor puts out limited power each turn, split between shields, weapons, engines and sensors.
- **Targeted systems:** aim at engines (stop them fleeing), weapons (force surrender), shields, or cargo bays (when you want the loot intact, aim elsewhere).
- **Escape:** fleeing is a real option, especially at long range with strong engines.
- **Boarding:** a disabled ship can be boarded. A short, resolved fight based on crew numbers, skill and gear.
- **Surrender and mercy:** enemies can surrender, and so can you. How you treat prisoners and surrendered crews affects reputation.
- Combat log reads as short lines: what happened, damage, current range, enemy status.

## Ship and crew

- Ship classes (examples): courier (fast, small hold), hauler (big hold, weak), gunship (strong weapons, small hold), plus balanced in-between hulls.
- Upgrade slots for weapons, shields, engines, reactor, cargo, sensors and smuggling compartments.
- **Crew:** count and skill matter for boarding, repairs and some systems. Crew need pay.
- **Crew loyalty** depends on pay, success, and whether they like the kind of captain you're becoming (lawful crews dislike piracy, and the reverse). Low loyalty means desertion, and at worst, mutiny.

## Death and loss

- **Losing your ship:** if your ship is destroyed but you survive (escape pod), insurance replaces it with a basic ship or pays part of its value. Insurance has a premium and may be denied or cost more for captains with criminal reputations. Cargo is lost.
- **Death:** game over. The player can reload a save.
- **When you can die:**
  - **Ship destroyed:** you escape in a pod and survive, unless the pod is caught by an enemy that hates you.
  - **Losing a boarding fight** (yours or theirs) can kill you.
  - **Capture and execution:** a faction that hates you can capture you (after you surrender, are disabled, or your pod is caught) and execute you. Factions that merely dislike you fine you, jail you or seize your cargo instead.

## Galaxy

- Large and randomly generated each campaign: about 120 systems in 9 regions.
- The Core Worlds sit in the middle (Concord-controlled, high security). Frontier regions surround them, and the four corner regions are lawless pirate territory, each held by a pirate clan.
- Systems are connected by jump lanes; travel happens lane by lane. A course plotter finds the shortest route to any system.
- Systems belong to factions, or are lawless or contested.
- Each system has a security level (how much the navy patrols), an economy type (mining, farming, industrial, etc.) that drives prices, and ports with services.
- Travel between systems takes time and fuel; random encounters happen along routes, and their odds depend on security level and your reputation.

## Saving

- Long, save-and-return campaign.
- Saves stored locally in the browser.

## Open questions

- Number of save slots, and whether there's an optional "one life" mode.
- Time pressure: does in-game time matter (deadlines, aging galaxy events)?
- Economy depth: how prices react to your own trading.
- Name check for conflicts (itch.io, Steam, App Store).

## Build plan (proposed)

1. Galaxy generation, travel and a basic trade loop. **(Built)**
2. Ports, missions and reputation.
3. Combat.
4. Boarding, crew and loyalty.
5. Insurance, death and saving.
6. Story arcs.
7. Balance and polish.

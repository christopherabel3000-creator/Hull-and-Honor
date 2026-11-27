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

## Stage 2 details (as built)

- **Standing tiers:** Hated (-60 and below), Hostile, Disliked, Neutral, Liked (10+), Trusted (30+), Honored (60+), Revered (85+). Tier changes are announced.
- **Offices by port:** Concord ports have a Merchant Guild office and a Concord navy post. Independent ports have a Guild office and a back-room pirate contact for the nearest clan. Clan ports have only the pirate contact.
- **Contract tiers 0–3** need Neutral, Liked, Trusted or Honored standing with the offering faction. Higher tiers go farther and pay more. Locked contracts are listed as a count with the standing they need. The first contract at each office is always entry level. Disliked or worse: no contracts from that faction. Boards refresh every 4 days. Up to 5 active contracts.
- **Contract types now:** Guild freight (takes hold space), Guild procurement (buy goods and bring them to the port), Concord dispatches (fast courier jobs to Concord systems), pirate smuggling (contraband crates; pays 40% more into Concord space).
- **Effects:** completing raises the faction and local standing. Concord work lowers every clan by 1; smuggling raises the other clans by 1. Failing (late, abandoned or seized) costs standing with the faction and the origin port.
- **Contraband goods:** illegal weapons and black-market tech, traded only outside Concord ports (cheap in clan ports, in demand in independent ports).
- **Customs:** arriving at a Concord port with contraband risks a scan (45% high security, 25% medium). Caught: contraband seized, fine of 1.5× its value, Concord -8, local -10, notoriety +3.
- **Docking refused** when the ruling faction is Hostile or worse, or local standing is -30 or worse (-50 at independent ports). In orbit you can still travel and buy emergency fuel at triple price.
- **Prices:** local standing moves prices by up to 5% either way.
- **Notoriety** rises with high-tier contracts and getting caught.
- Escort, patrol, bounty and piracy contracts arrive with combat in stage 3.

## Stage 3 details (as built)

- **Power:** reactor output split between shields, weapons and engines (0–4 each). Starter Mule: reactor 6, hull 60, shields 20, light laser and light cannon, crew 6.
- **Systems** have four states: operational, damaged, badly damaged, disabled. Damage scales effective power down; disabled means zero.
- **Shields** absorb damage first and regenerate 3 per effective shield power each turn.
- **Weapons:** light laser (best close), heavy laser, light cannon (best medium), heavy cannon, missile rack (best long, uses ammo). Each uses weapon power to fire; the screen shows hit chance at the current range.
- **Aiming** at shields, weapons or engines is 10% less accurate, does half hull damage and knocks the system down a level once shields are down. Hull hits can also damage a random system.
- **Maneuver:** close in, hold or pull back; engine power times agility decides contested moves. Pulling back successfully at extreme range escapes.
- **Enemies:** pirate cutter, raider, marauder, flagship; Guild hauler and armed convoy ship (they flee); Concord patrol cutter (attacks if you are Hostile or worse). Pirates aim for engines, merchants and patrols for weapons.
- **Actions:** fire and maneuver, demand surrender (instead of firing), board (close range, enemy engines disabled; odds shown; losing kills you), surrender.
- **Enemy surrender:** take their cargo, take a bounty target prisoner (+50% pay), let them go, or destroy them (big reputation and notoriety cost).
- **Pirate boarding:** pirates board you if your engines are disabled at close range and they have at least as many crew.
- **Your surrender:** pirates take your cargo and 30% of your credits; the Concord fines 40%, seizes contraband and jails you for 10 days, resetting your standing to Disliked. Anyone who hates you executes you instead.
- **Ship destroyed:** you escape in a pod. A faction that hates you catches the pod 60% of the time and executes you. Otherwise you're towed to the nearest port that will take you and get a used Mule, losing cargo and paying a 500 credit deductible. (Full insurance comes in stage 5.)
- **Game over** screen offers reloading from before the fight.
- **Random encounters** on arrival: 6% high security, 14% medium, 24% low, 34% none (at least 40% while escorting). Pirates let you pass if their clan Likes you. Merchants can be attacked (piracy: Guild -6, Concord -4 in patrolled space, clan +2) or ignored.
- **Rewards:** beating pirates pays a Concord bounty (120–600) unless you are Hostile with the Concord, and raises Concord standing; the clan's drops. Destroyed ships leave salvage.
- **New contracts:** Guild escort (fails if you flee), Concord patrol (clear 1–3 pirates) and bounty (named captain), pirate raid (attack a Guild convoy). Combat contracts trigger on arrival, and a Hunt or Search button retries.
- **Shipyard:** refuel, repair hull and systems, hire crew, restock missiles.

## Stage 4 details (as built)

- **Port views:** Bridge (status, travel, course), Contracts, Market (with price notes), Shipyard (services, outfitting, ship dealer), Crew, Records (reputation, log, game).
- **Ship classes** (price): Mule light freighter (6,000), Swift courier (9,000), Bulwark hauler (15,000), Talon gunship (20,000), Corsair raider (18,000, pirate ports, clan Liked), Atlas heavy freighter (30,000, Concord ports, Guild Trusted), Warden frigate (38,000, Concord ports, Concord Trusted), Reaver warship (36,000, pirate ports, clan Trusted). Each comes with a starting loadout.
- **Trade-in:** 60% of the class price (less for a damaged hull), plus half the value of added weapons and upgrades.
- **Outfitting:** weapons fill hardpoints (sell for half price). Heavy weapons are sold only at high-security Concord ports and pirate ports. Missile racks hold 6 missiles each.
- **Upgrades** (one of each per ship, fill upgrade slots, sell for half): armor plating, shield booster, reactor overhaul, tuned thrusters, targeting computer, cargo expansion, long-range tanks, extra crew quarters, hidden compartments (pirate and independent ports only; halves the customs catch chance).
- **Crew:** wages of 2 credits per crew member per day, paid on each jump; unpaid wages are owed and hurt loyalty. Loyalty: devoted, loyal, content, restless, near mutiny, mutinous.
- **Leaning:** hires at Concord ports lean lawful, at pirate ports outlaw, at independent ports mixed. Lawful crews dislike piracy, smuggling and destroying surrendered ships; outlaw crews dislike Concord work. The crew's leaning drifts toward how you act.
- **Morale:** completed contracts and victories raise loyalty; losing your ship or surrendering lowers it. Bonuses (25 per crew; full effect once every 5 days) and shore leave (15 per crew and a day) raise it.
- **Experience:** each victory makes the crew slightly better in boarding fights; new hires dilute it. Crew below 40 loyalty fight worse.
- **Desertion and mutiny:** below 30 loyalty, a fifth of the crew deserts at each port. Below 15, each jump has a 40% chance of mutiny: pay them off (150 per crew), fight (losing kills you), or give up command (game over).

## Stage 5 details (as built)

- **Insurance** is sold at Merchant Guild offices (Concord and independent ports) in 30-day policies:
  - Basic (3% of ship value): a used Mule plus half your ship's value in credits; deductible 500.
  - Full (6%): a new ship of the same class with the same weapons, no upgrades; deductible 1,000.
  - Premium (9%): same class, weapons and upgrades; deductible 1,500.
  - Premiums rise 25% per past claim, 30% at notoriety 25+, 50% when Disliked or worse by the Concord, and drop 20% when the Guild Trusts you. The Guild refuses if it is Hostile; nobody insures a captain the Concord hates. Policies lapse when their term ends. Losses during piracy (attacking merchants or raid contracts) are never covered.
- **Uninsured loss:** a battered Mule at half hull for 3,000 credits.
- **Guild debt:** anything you can't pay becomes debt to the Merchant Guild at 0.5% a day. Half of every payment you receive goes to it, and ship dealers won't sell to you until it's paid. Repay at any Guild office.
- **Saving:** autosave plus 3 manual save slots (Records view; overwriting asks to confirm). Saved games can be loaded from the title screen and the game over screen.
- **One life mode** (chosen at the start): no save slots and no reloading from before a fight. Death ends the campaign for good.

## Stage 7: balance and polish (first pass)

- **Measured:** a median one-jump trade earns about 190 credits in the starter Mule, minus about 75 in wages and fuel. Combat simulations ran every ship class against every enemy type.
- **Contracts** pay 25% more across the board.
- **Ship prices** lowered: courier 8,000, hauler 13,000, gunship 17,000, corsair 15,000, Atlas 26,000, Warden 33,000, Reaver 31,000.
- **Bounty hunters** toned down (they were beating frigates); they now chase harder instead. **Dreadnought** slightly weaker (hull 170, shields 40).
- **Pirate encounters** scale a little with your ship: weak ships meet fewer marauders and raiders, strong ships fewer cutters.
- **Stranded rescue:** with too little fuel to leave and no money to buy it, the Bridge offers a distress call. A Guild tug takes you to the nearest port that will take you, with 4 fuel, for 400 credits of Guild debt and 3 days.
- **Conveniences:** Sell all cargo (Market), Refuel, repair and restock everything (Shipyard), best known sell price shown for goods in your hold, price notes split into best places to sell and cheapest places to buy.
- **How to play** page, reachable from the title screen and the Records view.
- **Less repetition:** the Status list no longer repeats the day, credits, fuel and hull already in the summary line. The announcement region is a polite status region.
- **Tested:** about 10,000 random actions across five fuzz-test campaigns with no script errors.

## Captain skills (as built)

Nine skills, levels 1 to 10, shown in the Captain view. Every captain starts at 1 in each with 3 skill points to spend.

| Skill | Effect per level | Grows by |
|---|---|---|
| Piloting | +0.03 agility in combat (dodging, range control, escapes) | winning maneuvers, escaping |
| Gunnery | +1% to hit | landing hits |
| Repairs | emergency repairs in combat (3 + 2 per level hull, 40% + 6% per level to fix a system), 3 hull patched after each fight, shipyard repairs 4% cheaper | emergency repairs, shipyard hull repairs |
| Dueling | boarding parties and mutiny fights 4% stronger | boarding fights, mutiny fights |
| Leadership | loyalty gains 5% bigger, losses 5% smaller | bonuses, shore leave, ending mutinies |
| Trading | 1% better buy and sell prices | profitable sales |
| Negotiation | contracts pay 2% more, insurance 2% cheaper, surrender demands 3% likelier | completing contracts, successful demands |
| Navigation | less fuel and travel time per jump, 3% fewer random encounters | every jump (longer jumps teach more) |
| Deception | customs 5% less likely to catch you; better odds feeding both sides false information | getting contraband past customs, smuggling contracts |

- **Experience:** reaching the next level takes 10 + 10 × current level experience.
- **Trainers:** pay 300 × (level + 1) credits and spend 2 days to gain a level, up to level 6. Concord ports teach piloting, gunnery, repairs, navigation, leadership and negotiation. Independent ports teach trading, negotiation, repairs, navigation and deception. Pirate ports teach dueling, deception, gunnery, piloting and leadership.
- **Skill points:** 1 per story chapter completed and 1 per 8 contracts completed. Each point raises any skill by a level, up to 10.
- **Emergency repairs** is a new combat action, used instead of firing.
- A port's sell price can never reach its own buy price, so better prices can't be farmed at one port.

## Stage 6 details (as built)

Story offers appear on arrival when their conditions are met and are accepted or declined in the Contracts view. Story objectives sit in your contract list (they don't count toward the 5-contract limit and have no deadline). Choices are made in the Story part of the Contracts view. Abandoning a story objective ends that story.

- **Navy hero** (Concord Trusted, at a Concord port): a reserve commission (+25% pirate bounties), report to Admiral Rhee, destroy the outpost guard of the clan you are worst with, then defeat its lord's dreadnought. Reward: 8,000 credits, Concord +20, and Hero of the Concord (+50% bounties, Warden frigate without the standing requirement).
- **Pirate rise** (a clan Trusts you, at one of its ports): raid an armed Guild convoy, destroy a rival clan's captain, then take the clan's leadership by buying the elders' votes (12,000) or a duel with the lord's dreadnought. Reward: clan standing 100, its raiders never attack you, and 800 credits of tribute every 10 days at its ports; Concord -20, notoriety +20.
- **Double agent** (Concord and a clan both Trust you): a blackmailer. Pay 3,000, sell out the clan (assassin follows), warn the clan (Concord hunter follows), or play both sides (50%: 6,000 credits; or both sides turn on you). Ignoring the message leaks it: both -10.
- **Guild favorite** (Guild Trusted, at a Concord or independent port): address the council, deliver 15 of a good it wants, then deal with a rival house's bribe: expose it (5,000), take it (8,000, 50% chance the Guild finds out and the story ends), or refuse. Reward: Guild charter, +25% on Guild contracts.
- **Wanted** (Concord Hated; starts automatically and can happen again): bounty hunters appear on 15% of jumps. A lawyer clears your name for 15,000 credits or for killing a clan butcher. Your Concord standing becomes Neutral. The story also ends if your Concord standing climbs above Hostile some other way.
- **Clashes:** if you are in both the Navy hero and Pirate rise stories for the same clan, the next step makes you pick a side, and the other story ends.
- New enemies: pirate dreadnought (clan lords) and bounty hunter (fast, aims for your engines; works for the Concord).

## Story arcs (original outline)

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

- Time pressure: does in-game time matter (deadlines, aging galaxy events)?
- Economy depth: how prices react to your own trading.
- Name check for conflicts (itch.io, Steam, App Store).

## Variety roadmap

8. Jump events and derelict salvage. **(Built)**
9. Galaxy events (famines, plagues, booms, blockades) and faction wars. **(Built)**
10. Rival captains. **(Built)**
11. Officers with personalities, and mission twists.
12. Property (warehouses, trade route shares, a station) and port games (cards, dice, pit fights).

## Stage 8 details (as built)

- About 1 arrival in 4 without a fight brings a **jump event**: a short scene with choices. Some choices are skill checks, shown with the skill and the chance (base chance plus 6% per level); checks teach the skill either way.
- **Events:** distress beacon (may be a pirate trap; scan it first with navigation), stowaway (sometimes a fugitive), ion storm, a smuggler's offer, escape pod (merchant, spacer or wanted pirate), derelict, debris field, customs checkpoint (only in Concord space while carrying contraband: bribe, bluff, dump or run), crew dispute, a strange nebula, fuel leak, pirate toll (lawless space, when the clan doesn't Like you), merchant breakdown (help or rob), black box (decode it for cache coordinates).
- Event weights depend on security, your cargo, crew size and standing.
- **Derelict salvage:** a push-your-luck run. Each section deeper has a higher chance of trouble (10% plus 8% per section, less with repairs skill): crew lost, hull damage, or something in the dark (dueling can save your crew member). Sections hold credits or valuable goods; the last section holds 800–2,000 credits or intact parts installed as a free upgrade. You keep the haul only by returning to your ship. Caches from black boxes are deeper derelicts.
- Cache coordinates are listed in the Bridge status.

## Stage 9 details (as built)

- **Galaxy events** run for weeks and move prices at one system: famine (food x2.2, water x1.5), plague (medicine x2.6), mining boom (machinery, food, luxuries up; ore cheap), festival (luxuries, food, textiles up), glut (one good at 55%), blockade (all prices x1.35; blockade ships stop 70% of arrivals). Pirate surges cover a whole region: more and mostly pirate encounters. Up to 7 events at once; about a 13% chance of a new one each day; 4 at the start of a campaign.
- **Blockades:** a pirate clan blockades Concord ports and the Concord blockades clan ports. Pirate blockaders let you through if their clan Likes you; otherwise they attack. Concord blockaders attack if you are Disliked or worse, and otherwise may search you for contraband.
- **Wars:** the Concord against a clan, or clan against clan, at most two at once, declared every few weeks. A war has a score from -100 to 100 that drifts day by day and lasts 50 to 80 days or until one side reaches 100. The winner takes 1 to 3 of the loser's front systems, which change authority (and so docking, offices and ship dealers).
- **Fronts** are each side's systems nearest the enemy. Front systems pay more for weapons (x1.8), metals, machinery, medicine and food. Arriving at a front, there's a 30% chance of meeting warships: whichever side likes you least attacks if you are Disliked or worse.
- **War contracts** at navy posts and pirate contacts of warring factions: run war supplies to your side's front (cargo), or strike the enemy at their front (combat). Each completed war contract shifts the war 12 points toward your side, raises your side and lowers the enemy.
- **News view:** current wars (who's winning, nearest fronts), galaxy events with distance and days left, and recent headlines. New headlines are announced on arrival (up to three). Jump lane buttons mention events and war fronts at each destination, and the system summary mentions what's happening here.
- Border changes are saved and re-applied whenever the galaxy is loaded.

## Stage 10 details (as built)

- **Six rivals** per campaign, one of each style: a trader (Guild), a smuggler and a pirate captain (each tied to a clan), a bounty hunter and a Concord navy captain (Concord), and a mercenary (tied to a clan). Each has a name, a named ship, a level from 1 to 10 and an attitude toward you from -100 to 100 (nemesis, hostile, neutral, friendly, ally).
- **They live in the galaxy:** every 2 to 4 days each rival jumps to a neighboring system, preferring the kind of space their style favors. About once every 4 weeks a rival gains a level, which can mean a bigger ship. Their deeds show up in the news.
- **Meeting a rival** in port opens a scene: buy them a drink, swap news (they tell you about a galaxy event), race them to the next port for a 300 credit wager (piloting and navigation against their level), insult them, challenge them to a fight (fighting styles only), or leave. Hostile fighting rivals attack half the time; a nemesis attacks almost always and steers toward you.
- **Fighting a rival:** their ship scales with their level. Destroy it and they either escape in a pod (levels lost, attitude -30) or die. Take their ship and they're humiliated. If they surrender: spare them (+20, they remember), loot them (-10), take them prisoner (gone for good), or destroy them.
- **Contract races:** when you take a cargo contract while a rival trader or smuggler is in port (or sometimes anyway), they race you. Arrive before their expected day and the client pays a 20% bonus; arrive after and you get 60%.
- **Allies:** a fighting rival who is your ally and within 3 jumps has a 35% chance to jump into your fights, firing every turn.
- The **Rivals** view lists every rival: style, strength, ship, which faction they side with, their attitude, where you last saw them, and their recent history with you.

## Build plan (proposed)

1. Galaxy generation, travel and a basic trade loop. **(Built)**
2. Ports, missions and reputation. **(Built)**
3. Combat. **(Built)**
4. Ships, outfitting, crew and loyalty. **(Built)**
5. Insurance, death and saving. **(Built)**
6. Story arcs. **(Built)**
7. Balance and polish. **(Built, first pass)**

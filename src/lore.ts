/** Character biographies for the Codex.
 *
 * Flavour text, deliberately held apart from `roster.ts`: that file is the balance surface
 * and is edited when numbers change, which is the worst possible time to be scrolling past
 * prose. Nothing here is read by the engine, and nothing here may be derived from a fight.
 *
 * This is *not* a `disclosure.ts` channel. Everything below is identical on every day, for
 * every party, in every mode -- manual-grade reference a player could read before ever
 * pressing start. The line it must not cross is anything computed from the live battle:
 * "Fire II, 150 power" is content, "this will deal 143 to today's boss" is the action
 * preview, which Normal mode withholds on purpose. Keep the Codex on the content side of
 * that line and no disclosure field is needed.
 *
 * Typed as a total record over hero ids, so a new hero cannot ship without a biography --
 * the same device `disclosure.ts` uses to stop a field defaulting its way into a mode.
 */
import type {HeroId} from './roster.js';
import type {Capability} from './draft.js';

export type Lore = {
  /** Two or three sentences. Long enough to place the character, short enough for a card
   * that also carries a portrait and a stat block. */
  biography: string;
  /** How the character is referred to in any prose the interface generates about them.
   *
   * Carried as data rather than assumed from the name or the art, because three of these
   * are not `he`: the Channeler is `they`, the Warden is `it`, and the Oracle is `she`. A
   * renderer that needs a pronoun gets the right one instead of guessing. */
  pronoun: 'he' | 'she' | 'they' | 'it';
};

export const HERO_LORE: Record<HeroId, Lore> = {
  warden: {
    pronoun: 'it',
    biography: 'An obsidian-furred panther stepping silently from the shadows, The Warden '
      + 'ripples with the sleek musculature and quiet majesty of a primordial deity. Moving '
      + 'with entirely silent phantom strides, its massive paws leave glowing wisps of '
      + 'stardust scorched into the earth, radiating a terrifying divine aura that blurs the '
      + 'line between a protective god and a cosmic apex predator.',
  },
  lancer: {
    pronoun: 'he',
    biography: 'A stoic and unyielding Templar knight, Lancer serves as an impenetrable '
      + 'front-line bastion completely encased in heavy iron plate armor and a blank '
      + 'metallic helm. Draped in a stark white surcoat emblazoned with a bold, blood-red '
      + 'cross, he fights with a singular, terrifying discipline that masks all human '
      + 'emotion.',
  },
  oracle: {
    pronoun: 'she',
    biography: 'A gentle and fragile-looking white mage wrapped in oversized silken robes, '
      + 'The Oracle constantly trembles with a timid, anxious energy as she grips a wooden '
      + 'staff topped with a massive, glowing crystal. Though she frequently cowers behind '
      + 'her sturdier companions, her deep-seated fear vanishes the moment her allies are in '
      + 'peril, unlocking a breathtaking reservoir of holy power.',
  },
  blademage: {
    pronoun: 'he',
    biography: 'A charismatic young prince bearing the weight of his royal lineage, he moves '
      + 'across the battlefield with the effortless grace and confidence of an expert '
      + 'swordsman. Beneath his noble, refined demeanor lies a passionate warrior whose '
      + 'fierce determination to protect his kingdom makes him a dazzling, versatile prodigy '
      + 'on the front lines.',
  },
  channeler: {
    pronoun: 'they',
    biography: 'An enigmatic, blindfolded mystic dressed in flowing silken vestments and '
      + 'glowing talismans, The Channeler floats slightly above the ground as a living '
      + 'conduit for the spirit world. Lacking physical sight, their consciousness is '
      + 'entirely tuned to the cosmic ether, allowing them to invite powerful phantoms into '
      + 'their body to drastically alter their combat capabilities on the fly.',
  },
  nullifier: {
    pronoun: 'he',
    biography: 'A towering and ethereal entity, Nullifier cuts a striking, alien silhouette '
      + 'on the battlefield with his elongated limbs and smooth, featureless visage. Though '
      + 'his slender frame appears delicate, he commands a gravity-defying might as a '
      + 'legendary hero who single-handedly saved his population from cosmic extinction.',
  },
  monk: {
    pronoun: 'he',
    biography: 'A lithe and agile anthropomorphic monkey, Monk perfectly balances serene '
      + 'spirituality with deadly martial arts discipline. Remaining in a flawless Shaolin '
      + 'stance with his keen eyes scanning his surroundings, he relies on his fluid grace '
      + 'and spring-like limbs to unleash rapid-fire, acrobatic kung fu strikes.',
  },
  machinist: {
    pronoun: 'he',
    biography: 'A towering, broad-shouldered mechanic, The Machinist dominates the '
      + 'battlefield with unkempt hair slicked with sweat, dark engine oil, and calloused '
      + 'hands carrying the grime of heavy machinery. Beneath his stained canvas overalls '
      + 'beats the fiercely loyal heart of a protective guardian, unyielding in his devotion '
      + 'and possessing a raw, explosive physical strength.',
  },
  vanguard: {
    pronoun: 'he',
    biography: 'A slick and fast-talking corporate executive, Vanguard carries himself like '
      + 'a ruthless salesman until the pressure of battle triggers a savage transformation. '
      + 'With a terrifying surge of primal energy, he explodes out of his tailored business '
      + 'suit as thick fur erupts and his jaws elongate into a snarling wolfish maw. '
      + 'Shedding his corporate greed for pure bloodlust, he leaves behind his expensive '
      + 'attire to tear through enemy defenses as a towering, feral werewolf.',
  },
  brawler: {
    pronoun: 'he',
    biography: 'A massive, towering anthropomorphic grizzly bear, Brawler brings the raw '
      + 'power of the wilderness onto the front lines as a devastating shock trooper. While '
      + 'he carries a jovial, protective spirit and flashes a sharp-toothed grin, he relies '
      + 'entirely on overwhelming physical might to demolish enemy ranks with bone-crushing '
      + 'suplexes, devastating haymakers, and a screen-shaking roar.',
  },
  magus: {
    pronoun: 'he',
    biography: 'A looming and enigmatic sorcerer, Magus commands the battlefield with a '
      + 'dangerous, otherworldly presence that instantly dispels any notion of a harmless '
      + 'old man. Far from a benevolent mentor, his true allegiances lie with the secrets of '
      + 'the cosmos, allowing him to tear open dimensional rifts or summon cataclysmic '
      + 'starfire with a single movement of his fingers.',
  },
  thief: {
    pronoun: 'he',
    biography: 'A charming and quick-witted scoundrel, he exudes a dangerous, magnetic '
      + 'confidence that makes him a highly lethal foe and an asset to his allies. With '
      + 'lightning-fast reflexes and a pair of concealed weapons, he effortlessly darts '
      + 'through enemy lines to strike exposed blind spots and pilfer rare items when the '
      + 'odds are stacked against him.',
  },
};

export const loreFor = (id: HeroId): Lore => HERO_LORE[id]!;

/** Player-facing names for the capabilities a hero actually has.
 *
 * These replace the role label in the Codex. `role` is hand-assigned, carries no mechanical
 * weight -- the one rule keyed on it in `draft.ts` gates no party at all -- and had
 * collapsed to the point where six of twelve heroes read "Striker", which tells a player
 * nothing they can act on. Capabilities are *derived from ability data*, which is the
 * property `draft.ts` was built around and the reason they stayed honest while the roles
 * rotted: "Pierces armour" is useful against a high-defence boss in a way "Striker" is not.
 *
 * Total over `Capability`, so a new one has to be given a name here before it compiles --
 * the device `disclosure.ts` uses to stop a field slipping in undeclared.
 *
 * `hint` is the one-line explanation, for a tooltip or a detail view. Written for someone
 * who has never seen the ability list, so it says what the capability *does*, not which
 * ability grants it. */
export const CAPABILITY_LABEL: Record<Capability, {label: string; hint: string}> = {
  sustain: {
    label: 'Heals',
    hint: 'Can restore a wounded ally. No party without one is considered viable.',
  },
  physical: {
    label: 'Weapon damage',
    hint: 'Deals damage with steel or fists, reduced by the target\'s defence.',
  },
  magical: {
    label: 'Spell damage',
    hint: 'Deals damage with magic, which ignores physical defence entirely.',
  },
  pierce: {
    label: 'Pierces armour',
    hint: 'Ignores part of the target\'s defence, which is how a physical party answers '
      + 'a heavily armoured boss.',
  },
  support: {
    label: 'Buffs allies',
    hint: 'Applies a lasting effect to an ally, such as Protect, Shell or Haste.',
  },
  control: {
    label: 'Disrupts',
    hint: 'Steals, dispels, absorbs or redirects, rather than dealing damage.',
  },
};

/** Capability names for one hero, in the order `CAPABILITY_LABEL` declares them.
 *
 * Declaration order rather than alphabetical, so every card lists its tags in the same
 * sequence and the eye can compare two heroes without re-reading. */
export const capabilityLabels = (caps: readonly Capability[]): string[] =>
  (Object.keys(CAPABILITY_LABEL) as Capability[])
    .filter(c => caps.includes(c))
    .map(c => CAPABILITY_LABEL[c].label);

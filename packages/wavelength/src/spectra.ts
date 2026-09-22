import type { Level, Spectrum } from "./types";

function level(what: string, ...examples: string[]): Level {
  return { what, examples };
}

/**
 * Each level describes where a clue points, not an object that sits there.
 * A clue like "mustard" is a hint toward the hot-dog end; it is not itself a hot dog.
 * Examples are other clues, so the rubric shows the kind of association that counts.
 */
export const SPECTRA: readonly Spectrum[] = [
  {
    id: "hot-dog-sandwich",
    left: "hot dog",
    right: "sandwich",
    levels: [
      level("The clue points squarely at a hot dog: a sausage in a split bun, or something people meet with one.", "ballpark", "relish", "frankfurter"),
      level("The clue points near a hot dog, with only a small step toward other food served in bread.", "bratwurst", "corn dog"),
      level("The clue sits in the middle: a fair argument for either a hot dog or a sandwich.", "sausage and peppers", "a loaded long roll"),
      level("The clue points near a sandwich, while a sausage or a bun is still in view.", "toasted roll piled high", "sausage on sliced bread"),
      level("The clue points squarely at a sandwich: a filling between bread, not a sausage in a bun.", "pastrami on rye", "peanut butter and jelly"),
    ],
  },
  {
    id: "job-hobby",
    left: "a job",
    right: "a hobby",
    levels: [
      level("The clue points at paid work: a boss, a shift, a client, or a paycheck.", "timesheet", "the morning commute"),
      level("The clue points at work done for money, but casually or on the side.", "a side gig", "mowing for cash"),
      level("The clue could point either at a job or a hobby; both readings are fair.", "an open mic that sometimes pays", "a weekend market stall"),
      level("The clue points at something done for enjoyment that only sometimes involves money.", "a pottery class", "a garden that gives away vegetables"),
      level("The clue points at a hobby: done for enjoyment, with no customer and no paycheck.", "a jigsaw puzzle", "birdwatching"),
    ],
  },
  {
    id: "whisper-shout",
    left: "a whisper",
    right: "a shout",
    levels: [
      level("The clue points at something so quiet that only a person nearby would notice.", "a library", "a secret told in an ear"),
      level("The clue points at quiet speech a person a few steps away could still catch.", "a waiting room", "a muffled phone call"),
      level("The clue points at ordinary speaking volume, neither hushed nor raised.", "ordering at a counter", "talk across a table"),
      level("The clue points at a raised voice meant to reach someone who is not beside you.", "calling across a yard", "a coach over practice"),
      level("The clue points at a shout meant for a crowd, or loud enough to carry across a large space.", "a stadium chant", "yelling fire"),
    ],
  },
  {
    id: "morning-midnight",
    left: "early morning",
    right: "midnight",
    levels: [
      level("The clue points at early morning: waking, sunrise, breakfast.", "an alarm clock", "a rooster"),
      level("The clue points at late morning, still before lunch.", "brunch", "a second cup of coffee"),
      level("The clue points at the middle of the day, from lunch through mid-afternoon.", "a lunch break", "the school day"),
      level("The clue points at evening: dinner, after work, the sky getting dark.", "cooking dinner", "streetlights coming on"),
      level("The clue points at late night, around midnight, when most people are asleep or still out.", "last call", "a clock reading 12"),
    ],
  },
  {
    id: "everyday-rare",
    left: "everyday",
    right: "rare",
    levels: [
      level("The clue points at something a typical adult encounters most weeks.", "doing laundry", "a traffic light"),
      level("The clue points at something common, met several times a year rather than every week.", "a birthday cake", "a dentist visit"),
      level("The clue points at something occasional: many people have done it, few do it often.", "moving apartments", "a flat tire"),
      level("The clue points at something uncommon, which most people know only secondhand.", "jury duty", "the northern lights"),
      level("The clue points at something rare, which most people will never encounter.", "a solar eclipse over your own street", "a hole in one"),
    ],
  },
  {
    id: "fact-opinion",
    left: "a fact",
    right: "an opinion",
    levels: [
      level("The clue points at a checkable fact: a count, a date, or an event that happened.", "a store's closing time", "the boiling point of water"),
      level("The clue points at a factual claim that still depends on a definition or on how you count.", "which city is bigger", "the hottest summer"),
      level("The clue points at a mix: something checkable with an interpretation attached.", "blaming a logo for falling sales", "calling a team bad after three losses"),
      level("The clue points at a judgment that only barely hooks onto a fact.", "that film was too long", "the meeting was a waste"),
      level("The clue points at a pure opinion: taste or preference, with nothing to look up.", "vanilla over chocolate", "that color is ugly"),
    ],
  },
];

export function spectrumById(id: string): Spectrum | undefined {
  return SPECTRA.find((s) => s.id === id);
}

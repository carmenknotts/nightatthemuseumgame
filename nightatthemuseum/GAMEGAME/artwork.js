// =====================================================================
// THE ARTWORK CATALOG
// Each artwork is one recognized pose. To add or tune an artwork, edit
// this file only; sketch.js reads everything from here.
//
// pose: the direction of each body segment, in degrees, as seen on the
//   (mirrored) screen. 0 = pointing right, 90 = pointing down,
//   180 = pointing left, -90 = pointing up.
//   "l" means the limb on the LEFT side of the screen, "r" the right.
//   The game also accepts the mirror image of every pose, so players can
//   use either arm.
//     lUpper / rUpper  shoulder -> elbow
//     lFore  / rFore   elbow    -> wrist
//     lThigh / rThigh  hip      -> knee
//     lShin  / rShin   knee     -> ankle
// lean: how far the torso tilts from upright (degrees, + = toward screen right).
// legWeight: how much the legs count (default 0.6; arms count 1).
// extra(): an optional extra check that returns 0..1 (for things angles
//   alone miss, like "hands on the face"). It counts for 35% of the score.
// The same numbers draw the reference statue on the pedestal, so what
// players see is exactly what they are scored against.
// =====================================================================

const ARTWORKS = [
  {
    id: 'liberty',
    title: 'Statue of Liberty',
    artist: 'Frédéric Auguste Bartholdi',
    year: '1886',
    place: 'Liberty Island, New York',
    cue: 'Raise one arm straight up like a torch. Bend the other arm and hold it against your chest like a tablet.',
    pose: { lUpper: -100, lFore: -95, rUpper: 80, rFore: -130, lThigh: 95, lShin: 90, rThigh: 85, rShin: 90 },
    lean: 0,
    props: ['torch', 'tablet'],
    extra: () => anyWristAbove('nose', 0.45),
    facts: [
      'A gift from the people of France, dedicated in 1886.',
      'Gustave Eiffel, of Eiffel Tower fame, designed the iron skeleton inside.',
      'Her copper skin was once shiny brown. It turned green as it weathered.',
      'The tablet reads JULY IV MDCCLXXVI: July 4, 1776.',
    ],
  },
  {
    id: 'david',
    title: 'David',
    artist: 'Michelangelo',
    year: '1501–1504',
    place: "Galleria dell'Accademia, Florence",
    cue: 'Stand with your weight on one leg. Bring one hand up to your shoulder and let the other arm hang down.',
    pose: { lUpper: 100, lFore: -70, rUpper: 86, rFore: 88, lThigh: 92, lShin: 90, rThigh: 74, rShin: 100 },
    lean: 4,
    props: ['sling'],
    extra: () => 0.6 * handAtShoulder() + 0.4 * legsStraight(),
    facts: [
      'Carved from a single block of marble that other sculptors had given up on.',
      'He stands 5.17 metres (about 17 feet) tall.',
      'His relaxed, weight-on-one-leg stance is called contrapposto.',
      'He moved indoors in 1873; a copy now stands in the Piazza della Signoria.',
    ],
  },
  {
    id: 'scream',
    title: 'The Scream',
    artist: 'Edvard Munch',
    year: '1893',
    place: 'National Museum & Munch Museum, Oslo',
    cue: 'Bring both hands up to the sides of your face, elbows out. Look horrified!',
    pose: { lUpper: 120, lFore: -55, rUpper: 60, rFore: -125, lThigh: 92, lShin: 90, rThigh: 88, rShin: 90 },
    lean: 0,
    props: ['swirl'],
    extra: () => (wristNear('left_wrist', 'nose', 0.45) + wristNear('right_wrist', 'nose', 0.45)) / 2,
    facts: [
      'Not a statue at all: tonight it has escaped from its frame.',
      'Munch made several versions: paintings, pastels and prints.',
      'Two different versions were stolen, in 1994 and 2004. Both came back.',
      'Munch wrote that he felt "an infinite scream passing through nature".',
    ],
  },
  {
    id: 'dancer',
    title: 'Little Dancer Aged Fourteen',
    artist: 'Edgar Degas',
    year: 'c. 1878–1881',
    place: 'Casts in museums worldwide',
    cue: 'Clasp your hands behind your back, lift your chin, and put one foot forward, turned out.',
    pose: { lUpper: 110, lFore: 45, rUpper: 70, rFore: 135, lThigh: 95, lShin: 92, rThigh: 80, rShin: 74 },
    lean: 0,
    props: ['tutu'],
    // Hands behind the back are often hidden from the camera, which is fine:
    // a hidden hand counts as "behind your back".
    extra: () => (handBehindBack('left_wrist') + handBehindBack('right_wrist')) / 2,
    facts: [
      'The model was Marie van Goethem, a student at the Paris Opera Ballet.',
      'Degas showed her in 1881 sculpted in wax, with a real tutu and a real hair ribbon.',
      'Critics were shocked by how realistic she looked.',
      'The bronze copies you see today were cast after Degas died.',
    ],
  },
  {
    id: 'discobolus',
    title: 'Discobolus (The Discus Thrower)',
    artist: 'Myron',
    year: 'c. 460–450 BC',
    place: 'Roman copies in Rome and London',
    cue: 'Bend your knees, swing one arm back and up behind you, and reach the other hand down toward the opposite knee.',
    pose: { lUpper: -155, lFore: -150, rUpper: 115, rFore: 105, lThigh: 110, lShin: 78, rThigh: 62, rShin: 98 },
    lean: 18,
    props: ['disc'],
    legWeight: 0.9,
    extra: () => 0.5 * anyWristAbove('left_shoulder', 0.1) + 0.5 * (1 - legsStraight()),
    facts: [
      'The Greek original was bronze and has been lost.',
      'We know it from Roman marble copies made centuries later.',
      'It freezes the instant before the throw, full of stored energy.',
      'It is one of the most copied athletic poses in art history.',
    ],
  },
  {
    id: 'thinker',
    title: 'The Thinker',
    artist: 'Auguste Rodin',
    year: '1880 (enlarged 1904)',
    place: 'Musée Rodin, Paris',
    cue: 'Crouch low or sit on a chair. Rest your elbow near your knee and put your chin on your hand.',
    pose: { lUpper: 95, lFore: 60, rUpper: 105, rFore: -100, lThigh: 135, lShin: 80, rThigh: 45, rShin: 100 },
    lean: 0,
    props: ['rock'],
    legWeight: 1.2, // the crouch is what sets it apart
    extra: () => 0.5 * Math.max(wristNear('left_wrist', 'nose', 0.45), wristNear('right_wrist', 'nose', 0.45)) + 0.5 * (1 - legsStraight()),
    facts: [
      'He was first called The Poet, and was meant to show Dante.',
      'He sat at the top of a huge doorway called The Gates of Hell.',
      'Rodin enlarged him in 1904 and he became famous on his own.',
      'There are more than 20 full-size bronze casts around the world.',
    ],
  },
];

/**
 * Anonymous username generator.
 *
 * Inspired by Docker container names (adjective + famous person) and
 * Google Docs anonymous animals (Anonymous Raccoon, etc.).
 * Produces names like "Witty Raccoon", "Bold Penguin", "Clever Fox".
 */

const ADJECTIVES: string[] = [
  'Agile', 'Ambitious', 'Amused', 'Ancient', 'Animated',
  'Brave', 'Bright', 'Breezy', 'Bold', 'Brilliant',
  'Calm', 'Cheerful', 'Clever', 'Cosmic', 'Curious',
  'Daring', 'Dazzling', 'Determined', 'Dreamy', 'Dynamic',
  'Eager', 'Earnest', 'Eccentric', 'Electric', 'Eloquent',
  'Fearless', 'Feisty', 'Festive', 'Focused', 'Friendly',
  'Gallant', 'Gentle', 'Gracious', 'Groovy', 'Gutsy',
  'Happy', 'Hardy', 'Heroic', 'Honest', 'Hopeful',
  'Ingenious', 'Inspired', 'Inventive', 'Jolly', 'Joyful',
  'Kind', 'Lively', 'Loyal', 'Lucky', 'Majestic',
  'Merry', 'Mighty', 'Mindful', 'Modest', 'Mysterious',
  'Nimble', 'Noble', 'Nifty', 'Optimistic', 'Original',
  'Patient', 'Peaceful', 'Perky', 'Playful', 'Plucky',
  'Quick', 'Quirky', 'Radiant', 'Resilient', 'Resourceful',
  'Serene', 'Sharp', 'Silly', 'Sincere', 'Sleek',
  'Smart', 'Spirited', 'Spunky', 'Steadfast', 'Stellar',
  'Swift', 'Tall', 'Tenacious', 'Thoughtful', 'Tidy',
  'Unique', 'Upbeat', 'Valiant', 'Vibrant', 'Vigilant',
  'Warm', 'Witty', 'Wonderful', 'Zesty', 'Zippy',
];

const ANIMALS: string[] = [
  'Albatross', 'Axolotl', 'Badger', 'Bat', 'Bear',
  'Beaver', 'Bison', 'Boar', 'Buffalo', 'Capybara',
  'Chameleon', 'Cheetah', 'Chinchilla', 'Chipmunk', 'Cobra',
  'Coyote', 'Crane', 'Crow', 'Deer', 'Dingo',
  'Dolphin', 'Duck', 'Eagle', 'Echidna', 'Elephant',
  'Elk', 'Ferret', 'Flamingo', 'Fox', 'Frog',
  'Gecko', 'Giraffe', 'Gorilla', 'Hamster', 'Hawk',
  'Hedgehog', 'Heron', 'Hippo', 'Hummingbird', 'Hyena',
  'Ibis', 'Iguana', 'Jaguar', 'Jellyfish', 'Kangaroo',
  'Koala', 'Lemur', 'Leopard', 'Lion', 'Llama',
  'Lynx', 'Manatee', 'Meerkat', 'Mongoose', 'Moose',
  'Narwhal', 'Ocelot', 'Octopus', 'Okapi', 'Orca',
  'Otter', 'Owl', 'Panda', 'Panther', 'Parrot',
  'Peacock', 'Pelican', 'Penguin', 'Phoenix', 'Platypus',
  'Porcupine', 'Puffin', 'Quokka', 'Raccoon', 'Raven',
  'Rhino', 'Salamander', 'Seal', 'Shark', 'Sloth',
  'Snail', 'Sparrow', 'Squirrel', 'Swan', 'Tiger',
  'Toucan', 'Turtle', 'Viper', 'Walrus', 'Weasel',
  'Wolf', 'Wolverine', 'Wombat', 'Yak', 'Zebra',
];

/**
 * Generates a random anonymous username in the format "Adjective Animal".
 * e.g. "Witty Raccoon", "Bold Penguin", "Clever Fox"
 */
export function generateAnonymousUsername(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adjective} ${animal}`;
}


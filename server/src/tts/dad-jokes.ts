/**
 * Dad Jokes for voice preview synthesis.
 * 
 * These short jokes are ideal for testing TTS voices - they're brief,
 * feature varied phonetics, and are family-friendly.
 */

/** Collection of dad jokes suitable for voice previews (1-2 sentences) */
export const DAD_JOKES: string[] = [
  "Why don't scientists trust atoms? Because they make up everything!",
  "I'm reading a book about anti-gravity. It's impossible to put down!",
  "Did you hear about the claustrophobic astronaut? He just needed a little space.",
  "I used to hate facial hair, but then it grew on me.",
  "What do you call a fake noodle? An impasta!",
  "I only know 25 letters of the alphabet. I don't know y.",
  "What do you call a fish without eyes? A fsh!",
  "I'm on a seafood diet. I see food, and I eat it.",
  "Why did the scarecrow win an award? Because he was outstanding in his field!",
  "I told my wife she was drawing her eyebrows too high. She looked surprised.",
  "What do you call a bear with no teeth? A gummy bear!",
  "Why don't eggs tell jokes? They'd crack each other up!",
  "I used to play piano by ear, but now I use my hands.",
  "What's the best thing about Switzerland? I don't know, but the flag is a big plus.",
  "Did you hear about the restaurant on the moon? Great food, but no atmosphere.",
  "I'm afraid for the calendar. Its days are numbered.",
  "Why do fathers take an extra pair of socks when they go golfing? In case they get a hole in one!",
  "What do you call a dinosaur that crashes their car? Tyrannosaurus Wrecks!",
  "I asked my dog what's two minus two. He said nothing.",
  "Why did the math book look so sad? Because it had too many problems.",
  "What do you call a boomerang that won't come back? A stick.",
  "I used to be a banker, but I lost interest.",
  "What's orange and sounds like a parrot? A carrot!",
  "Why can't your nose be 12 inches long? Because then it would be a foot.",
  "What do you call a sleeping dinosaur? A dino-snore!",
];

/**
 * Get a random dad joke from the collection.
 * @returns A randomly selected dad joke
 */
export function getRandomJoke(): string {
  return DAD_JOKES[Math.floor(Math.random() * DAD_JOKES.length)];
}

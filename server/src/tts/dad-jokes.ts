/**
 * Dad Jokes Collection for Voice Preview
 * 
 * Short, family-friendly dad jokes used for voice preview synthesis.
 * Jokes are kept short (1-2 sentences) to minimize synthesis time and audio size.
 */

export const DAD_JOKES: readonly string[] = [
  "Why don't scientists trust atoms? Because they make up everything!",
  "I'm reading a book about anti-gravity. It's impossible to put down!",
  "Why did the scarecrow win an award? He was outstanding in his field!",
  "I used to hate facial hair, but then it grew on me.",
  "What do you call a fake noodle? An impasta!",
  "Why don't eggs tell jokes? They'd crack each other up!",
  "I'm on a seafood diet. I see food and I eat it!",
  "What do you call a bear with no teeth? A gummy bear!",
  "Why did the coffee file a police report? It got mugged!",
  "I would tell you a construction joke, but I'm still working on it.",
  "What's orange and sounds like a parrot? A carrot!",
  "Why do cows wear bells? Because their horns don't work!",
  "I told my wife she was drawing her eyebrows too high. She looked surprised.",
  "What do you call a dog that does magic? A Labracadabrador!",
  "Why don't skeletons fight each other? They don't have the guts!",
  "I got a job at a bakery because I kneaded dough.",
  "What's the best time to go to the dentist? Tooth-hurty!",
  "Why did the bicycle fall over? It was two tired!",
  "I'm afraid for the calendar. Its days are numbered.",
  "What do you call a fish without eyes? A fsh!",
  "Why can't you give Elsa a balloon? Because she'll let it go!",
  "I used to play piano by ear, but now I use my hands.",
  "What do you call cheese that isn't yours? Nacho cheese!",
  "Why did the math book look so sad? It had too many problems!",
  "I have a joke about time travel, but you didn't like it.",
] as const;

/**
 * Get a random dad joke for voice preview.
 * 
 * @returns A random dad joke string
 */
export function getRandomJoke(): string {
  return DAD_JOKES[Math.floor(Math.random() * DAD_JOKES.length)];
}

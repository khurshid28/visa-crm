// Inson kabi tasodifiy harakat yordamchilari (bot-belgilarni kamaytirish uchun).

/** [min, max) oralig'ida tasodifiy butun son. */
export function rand(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

/** Inson kabi tasodifiy qisqa kutish. */
export async function humanPause(min = 120, max = 380): Promise<void> {
  await new Promise((r) => setTimeout(r, rand(min, max)));
}

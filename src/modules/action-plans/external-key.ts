/** Prefixo das chaves geradas pelo sistema; a coluna A da planilha base. */
const GENERATED_PREFIX = 'A-';
const GENERATED_PATTERN = /^A-(\d+)$/;
const PAD = 4;

export function createExternalKeyAllocator(existingKeys: Array<string | null>): () => string {
  let highest = 0;
  for (const key of existingKeys) {
    const match = key?.match(GENERATED_PATTERN);
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > highest) highest = value;
  }

  return () => {
    highest += 1;
    return `${GENERATED_PREFIX}${String(highest).padStart(PAD, '0')}`;
  };
}

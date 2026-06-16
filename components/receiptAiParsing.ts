type ParseReceiptWithFallbackOptions<T> = {
  primaryDataUrl: string;
  fallbackDataUrl?: string;
  parse: (dataUrl: string) => Promise<T>;
  isValid: (candidate: T) => boolean;
};

export const parseReceiptWithFallback = async <T>({
  primaryDataUrl,
  fallbackDataUrl,
  parse,
  isValid,
}: ParseReceiptWithFallbackOptions<T>): Promise<T> => {
  let primaryResult: T | null = null;
  let primaryError: unknown = null;

  try {
    primaryResult = await parse(primaryDataUrl);
    if (isValid(primaryResult)) return primaryResult;
  } catch (error) {
    primaryError = error;
  }

  if (fallbackDataUrl && fallbackDataUrl !== primaryDataUrl) {
    try {
      const fallbackResult = await parse(fallbackDataUrl);
      if (isValid(fallbackResult) || !primaryResult) return fallbackResult;
    } catch (fallbackError) {
      if (!primaryResult) throw fallbackError;
    }
  }

  if (primaryResult) return primaryResult;
  throw primaryError instanceof Error ? primaryError : new Error('Analyse IA impossible.');
};

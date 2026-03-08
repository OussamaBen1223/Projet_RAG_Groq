import { useState, useEffect } from 'react';

const TYPING_SPEED = 20;

export function useTypingEffect(text, enabled = true) {
  const [displayedLength, setDisplayedLength] = useState(0);

  useEffect(() => {
    if (!enabled || !text) {
      setDisplayedLength(text?.length ?? 0);
      return;
    }
    setDisplayedLength(0);
    let current = 0;
    const timer = setInterval(() => {
      current += 1;
      setDisplayedLength(current);
      if (current >= text.length) {
        clearInterval(timer);
      }
    }, TYPING_SPEED);
    return () => clearInterval(timer);
  }, [text, enabled]);

  return text?.substring(0, displayedLength) ?? '';
}

import { useEffect, useRef, useState } from 'react';

export function useInView(rootMargin = '220px') {
  const ref = useRef<HTMLLIElement | null>(null);
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === 'undefined',
  );

  useEffect(() => {
    if (inView) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
}

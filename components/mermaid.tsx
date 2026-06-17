'use client';
import { useEffect, useRef } from 'react';
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, theme: 'default' });

export function Mermaid({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    mermaid.render(`mermaid-${Math.random().toString(36).slice(2)}`, chart).then(({ svg }) => {
      if (ref.current) ref.current.innerHTML = svg;
    });
  }, [chart]);

  return <div ref={ref} className="my-4 flex justify-center overflow-x-auto" />;
}

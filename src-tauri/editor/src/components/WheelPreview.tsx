import { useEffect, useRef } from 'react';
import { activeMenu } from '../editor-state';
import type { Settings } from '../types';

// Rendering is shared with the overlay; the schematic never mounts its controller.
export function WheelPreview({ settings, selected }: { settings: Settings; selected: string | null }) {
  const stage = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const images = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let draw = () => {};
    void import('../../../ui/wheel-renderer.js').then(({ renderWheel }) => {
      if (disposed) return;
      draw = () => {
        if (disposed || !stage.current || !svg.current || !images.current) return;
        const { width, height } = stage.current.getBoundingClientRect();
        if (!width || !height) return;
        const menu = activeMenu(settings), items = menu?.items || [];
        renderWheel(svg.current, images.current, {
          width, height, size: Math.min(width, height) - 12, items, title: menu?.name || 'Orbit',
          selected: items.findIndex((item) => item.id === selected), hot: null, keyboard: false, back: false,
          foreground: null, addSlot: false, wheelAddSlot: false,
          menuIndex: menu ? settings.menus.indexOf(menu) : -1, menuCount: settings.menus.length,
        }, draw);
        for (const node of svg.current.querySelectorAll('[tabindex]')) { node.removeAttribute('tabindex'); node.removeAttribute('role'); }
      };
      observer = new ResizeObserver(draw);
      if (stage.current) observer.observe(stage.current);
      window.addEventListener('resize', draw);
      void document.fonts.ready.then(draw);
      draw();
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener('resize', draw);
      svg.current?.replaceChildren();
      images.current?.replaceChildren();
    };
  }, [settings, selected]);
  return <div className="relative aspect-square max-h-107 min-h-70 w-full max-[900px]:aspect-auto max-[900px]:h-90 max-[900px]:max-h-90" id="preview-stage" ref={stage} role="img" aria-label="Схематичний перегляд активного меню"><svg id="editor-wheel" ref={svg} aria-hidden="true" focusable="false" /><div id="editor-wheel-images" ref={images} aria-hidden="true" /></div>;
}

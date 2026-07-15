type PageScrollSnapshot = {
  left: number;
  top: number;
};

function getPageScroller() {
  return (document.querySelector("main") as HTMLElement | null) || document.scrollingElement;
}

export function getPageScrollSnapshot(): PageScrollSnapshot {
  const scroller = getPageScroller();
  return {
    left: scroller?.scrollLeft ?? window.scrollX,
    top: scroller?.scrollTop ?? window.scrollY,
  };
}

export function restorePageScrollSnapshot(snapshot: PageScrollSnapshot) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const scroller = getPageScroller();
      if (scroller) {
        scroller.scrollTo({ left: snapshot.left, top: snapshot.top, behavior: "auto" });
      } else {
        window.scrollTo({ left: snapshot.left, top: snapshot.top, behavior: "auto" });
      }
    });
  });
}

export async function preservePageScroll<T>(work: () => Promise<T>): Promise<T> {
  const snapshot = getPageScrollSnapshot();
  try {
    return await work();
  } finally {
    restorePageScrollSnapshot(snapshot);
  }
}

/** 表示中のダイアログの中にキーボードのフォーカスを閉じ込める（TAKO-SEN の ui/dialog.ts と同じ） */
export function trapDialogFocus(event: KeyboardEvent, dialog: HTMLElement | undefined): void {
  if (event.key !== 'Tab' || !dialog) return;
  const focusable = [
    ...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled]), a[href]'),
  ].filter((element) => element.getClientRects().length > 0);
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
    event.preventDefault();
    first.focus();
  }
}

import type { FieldSelection, PickerState } from '@zfs-boe-inspector/shared-types';
import { parseFieldDomId } from './fieldInspector';

const INSPECTOR_Z_INDEX = '2147483647';

interface FieldTarget {
  containers: HTMLElement[];
  idElement: HTMLElement;
  selection: FieldSelection;
}

function fieldContainer(element: HTMLElement): HTMLElement {
  return element.closest<HTMLElement>('.el-form-item')
    ?? element.closest<HTMLElement>('.bill-td')
    ?? element.closest<HTMLElement>('.bill-field')
    ?? element;
}

function targetFromIdElement(idElement: HTMLElement): FieldTarget | undefined {
  const selection = parseFieldDomId(idElement.id);
  if (!selection) return undefined;
  const matchingElements = Array.from(document.querySelectorAll<HTMLElement>(`#${CSS.escape(idElement.id)}`));
  const containers = [...new Set((matchingElements.length ? matchingElements : [idElement]).map(fieldContainer))];
  return { containers, idElement, selection };
}

function nearestFieldTarget(target: EventTarget | null): FieldTarget | undefined {
  let element = target instanceof Element ? target : undefined;
  while (element && element !== document.body) {
    if (element instanceof HTMLElement && element.id) {
      const matched = targetFromIdElement(element);
      if (matched) return matched;
    }
    element = element.parentElement ?? undefined;
  }
  const container = target instanceof Element
    ? target.closest<HTMLElement>('.el-form-item, .bill-td, .bill-field')
    : undefined;
  if (!container) return undefined;
  const idElement = Array.from(container.querySelectorAll<HTMLElement>('[id]'))
    .find(({ id }) => Boolean(parseFieldDomId(id)));
  return idElement ? targetFromIdElement(idElement) : undefined;
}

function combinedRect(elements: HTMLElement[]): DOMRect | undefined {
  const rects = elements.map((element) => element.getBoundingClientRect())
    .filter(({ width, height }) => width > 0 && height > 0);
  if (!rects.length) return undefined;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

export class FieldPicker {
  private state: PickerState = { active: false };
  private highlighted: FieldTarget | undefined;
  private overlay: HTMLDivElement | undefined;
  private hint: HTMLDivElement | undefined;
  private cursorStyle: HTMLStyleElement | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;

  getState(): PickerState {
    return { ...this.state };
  }

  start(timeoutMs = 30_000): PickerState {
    this.cancel();
    this.state = { active: true };
    this.createInspectorLayers();
    document.addEventListener('mousemove', this.handleMove, true);
    document.addEventListener('click', this.handleClick, true);
    document.addEventListener('keydown', this.handleKeydown, true);
    document.addEventListener('scroll', this.handleViewportChange, true);
    window.addEventListener('resize', this.handleViewportChange, true);
    this.timeout = setTimeout(() => this.finish(undefined, '字段选择已超时'), timeoutMs);
    return this.getState();
  }

  cancel(): PickerState {
    if (this.state.active) this.finish();
    return this.getState();
  }

  private handleMove = (event: MouseEvent) => {
    const target = nearestFieldTarget(event.target);
    if (!target) {
      this.clearHighlight();
      this.state = { active: true };
      return;
    }
    if (target.idElement === this.highlighted?.idElement) return;
    this.highlighted = target;
    this.renderHighlight();
    this.state = { active: true, hoveredDomId: target.idElement.id };
  };

  private handleClick = (event: MouseEvent) => {
    const target = nearestFieldTarget(event.target);
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.finish(target.selection);
  };

  private handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.finish();
    }
  };

  private handleViewportChange = () => {
    if (this.highlighted) this.renderHighlight();
  };

  private renderHighlight() {
    if (!this.highlighted || !this.overlay) return;
    const rect = combinedRect(this.highlighted.containers);
    if (!rect) {
      this.clearHighlight();
      return;
    }
    Object.assign(this.overlay.style, {
      display: 'block',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  }

  private createInspectorLayers() {
    this.overlay = document.createElement('div');
    this.overlay.dataset.zfsBoeInspector = 'field-overlay';
    this.overlay.style.cssText = [
      'position:fixed',
      'display:none',
      'pointer-events:none',
      `z-index:${INSPECTOR_Z_INDEX}`,
      'box-sizing:border-box',
      'border:2px solid #635bff',
      'border-radius:12px',
      'background:rgba(99,91,255,.12)',
      'transition:left 60ms linear,top 60ms linear,width 60ms linear,height 60ms linear',
    ].join(';');

    this.hint = document.createElement('div');
    this.hint.dataset.zfsBoeInspector = 'field-hint';
    this.hint.textContent = '选择 BOE 字段 · 点击确认 · Esc 取消';
    this.hint.style.cssText = [
      'position:fixed',
      'top:12px',
      'left:50%',
      'transform:translateX(-50%)',
      'pointer-events:none',
      `z-index:${INSPECTOR_Z_INDEX}`,
      'padding:8px 14px',
      'border-radius:18px',
      'background:#4f46e5',
      'box-shadow:0 6px 18px rgba(15,23,42,.24)',
      'color:#fff',
      'font:600 13px/1.2 system-ui,sans-serif',
      'white-space:nowrap',
    ].join(';');

    this.cursorStyle = document.createElement('style');
    this.cursorStyle.textContent = '[data-zfs-boe-picker-active] * { cursor: crosshair !important; }';
    document.documentElement.dataset.zfsBoePickerActive = '';
    document.head.appendChild(this.cursorStyle);
    document.body.append(this.overlay, this.hint);
  }

  private finish(selection?: FieldSelection, error?: string) {
    document.removeEventListener('mousemove', this.handleMove, true);
    document.removeEventListener('click', this.handleClick, true);
    document.removeEventListener('keydown', this.handleKeydown, true);
    document.removeEventListener('scroll', this.handleViewportChange, true);
    window.removeEventListener('resize', this.handleViewportChange, true);
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = undefined;
    this.destroyInspectorLayers();
    this.state = {
      active: false,
      ...(selection ? { selection } : {}),
      ...(error ? { error } : {}),
    };
  }

  private clearHighlight() {
    this.highlighted = undefined;
    if (this.overlay) this.overlay.style.display = 'none';
  }

  private destroyInspectorLayers() {
    this.clearHighlight();
    this.overlay?.remove();
    this.hint?.remove();
    this.cursorStyle?.remove();
    delete document.documentElement.dataset.zfsBoePickerActive;
    this.overlay = undefined;
    this.hint = undefined;
    this.cursorStyle = undefined;
  }
}

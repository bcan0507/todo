(() => {
  'use strict';

  const STORAGE_KEY = 'todo-app:v1';
  const MAX_LENGTH = 200;
  const UNDO_MS = 7000;

  const FILTERS = {
    all: () => true,
    active: (todo) => !todo.done,
    done: (todo) => todo.done,
  };

  const EMPTY_MESSAGES = {
    all: '할 일이 없어요. 위에서 하나 추가해 보세요.',
    active: '남은 할 일이 없어요. 수고했어요!',
    done: '완료한 항목이 아직 없어요.',
  };

  const SVG_OPEN =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';
  const ICONS = {
    edit: `${SVG_OPEN}<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
    delete:
      `${SVG_OPEN}<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>` +
      '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
  };

  const $ = (selector) => document.querySelector(selector);
  const els = {
    today: $('#today'),
    form: $('#add-form'),
    input: $('#new-todo'),
    list: $('#list'),
    empty: $('#empty'),
    count: $('#count'),
    filters: $('.filters'),
    clearDone: $('#clear-done'),
    toast: $('#toast'),
    toastMsg: $('#toast-msg'),
    toastUndo: $('#toast-undo'),
  };

  const state = {
    todos: load(),
    filter: 'all',
    editingId: null, // id of the todo currently being edited
  };

  /* ---------- Persistence ---------- */

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(data)) return [];
      return data
        .filter((t) => t && typeof t.id === 'string' && typeof t.text === 'string')
        .map((t) => ({ id: t.id, text: t.text, done: Boolean(t.done) }));
    } catch {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.todos));
    } catch {
      // Storage unavailable (private mode, quota...): keep working in memory.
    }
  }

  /* ---------- State changes ---------- */

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const findTodo = (id) => state.todos.find((todo) => todo.id === id);

  function commit() {
    save();
    render();
  }

  function addTodo(text) {
    state.todos.unshift({ id: newId(), text, done: false });
    // A new item is never "done", so make sure the user can see it.
    if (state.filter === 'done') state.filter = 'all';
    commit();
  }

  function toggleTodo(id, done) {
    const todo = findTodo(id);
    if (!todo) return;
    todo.done = done;
    commit();
  }

  function startEdit(id) {
    state.editingId = id;
    render();
  }

  // value === null cancels the edit. Empty or unchanged text keeps the original.
  function endEdit(id, value, { restoreFocus = true } = {}) {
    if (state.editingId !== id) return; // already finished (Enter/Esc followed by blur)
    state.editingId = null;
    const todo = findTodo(id);
    const text = value === null ? '' : value.trim();
    if (todo && text && text !== todo.text) {
      todo.text = text;
      commit();
    } else {
      render({ restoreFocus });
    }
  }

  function removeTodos(shouldRemove) {
    const removed = [];
    state.todos = state.todos.filter((todo, index) => {
      if (!shouldRemove(todo)) return true;
      removed.push({ todo, index });
      return false;
    });
    if (removed.length === 0) return;

    commit();
    showToast(`할 일 ${removed.length}개를 삭제했어요.`, () => {
      // Re-insert in ascending index order to restore the original positions.
      for (const { todo, index } of removed) state.todos.splice(index, 0, todo);
      commit();
    });
  }

  /* ---------- Rendering ---------- */

  const nodes = new Map(); // todo id -> { li, sig }; lets unchanged rows stay untouched

  function iconButton(role, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-btn';
    button.dataset.role = role;
    button.title = role === 'edit' ? '수정' : '삭제';
    button.setAttribute('aria-label', label);
    button.innerHTML = ICONS[role]; // static, trusted markup
    return button;
  }

  function buildItem(todo, editing) {
    const li = document.createElement('li');
    li.className = todo.done ? 'item is-done' : 'item';
    li.dataset.id = todo.id;

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'check';
    check.dataset.role = 'check';
    check.checked = todo.done;
    check.setAttribute('aria-label', todo.text);
    li.append(check);

    if (editing) {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'edit-input';
      input.dataset.role = 'edit-input';
      input.value = todo.text;
      input.maxLength = MAX_LENGTH;
      input.setAttribute('aria-label', '할 일 수정');
      li.append(input);
      return li;
    }

    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = todo.text;

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(
      iconButton('edit', `수정: ${todo.text}`),
      iconButton('delete', `삭제: ${todo.text}`),
    );

    li.append(text, actions);
    return li;
  }

  // Updates the <ul> in place: only rows whose content changed are rebuilt,
  // so a click that lands on another row while an edit is being committed is not lost.
  function syncList(visible) {
    const keep = new Set();

    visible.forEach((todo, i) => {
      keep.add(todo.id);
      const editing = state.editingId === todo.id;
      const sig = `${todo.done}|${editing}|${todo.text}`;

      let entry = nodes.get(todo.id);
      if (!entry || entry.sig !== sig) {
        const li = buildItem(todo, editing);
        if (entry) entry.li.replaceWith(li);
        entry = { li, sig };
        nodes.set(todo.id, entry);
      }
      if (els.list.children[i] !== entry.li) {
        els.list.insertBefore(entry.li, els.list.children[i] || null);
      }
    });

    for (const [id, entry] of nodes) {
      if (keep.has(id)) continue;
      entry.li.remove();
      nodes.delete(id);
    }
  }

  function captureFocus() {
    const active = document.activeElement;
    if (!active || !els.list.contains(active)) return null;
    const li = active.closest('.item');
    return li ? { id: li.dataset.id, role: active.dataset.role } : null;
  }

  function restoreFocus(saved) {
    if (!saved) return;
    const role = saved.role === 'edit-input' ? 'edit' : saved.role;
    nodes.get(saved.id)?.li.querySelector(`[data-role="${role}"]`)?.focus();
  }

  function render({ restoreFocus: shouldRestoreFocus = true } = {}) {
    const savedFocus = captureFocus();
    const visible = state.todos.filter(FILTERS[state.filter]);
    syncList(visible);

    const remaining = state.todos.filter(FILTERS.active).length;
    els.count.textContent = `남은 할 일 ${remaining}개`;
    els.empty.textContent = EMPTY_MESSAGES[state.filter];
    els.empty.hidden = visible.length > 0;
    els.clearDone.disabled = remaining === state.todos.length;
    for (const button of els.filters.querySelectorAll('[data-filter]')) {
      button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter));
    }

    const editor = els.list.querySelector('.edit-input');
    if (editor) {
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    } else if (shouldRestoreFocus) {
      restoreFocus(savedFocus);
    }
  }

  /* ---------- Undo toast ---------- */

  let toastTimer = 0;
  let undoAction = null;

  function showToast(message, onUndo) {
    undoAction = onUndo;
    els.toastMsg.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, UNDO_MS);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    els.toast.hidden = true;
    undoAction = null;
  }

  els.toastUndo.addEventListener('click', () => {
    const action = undoAction;
    hideToast();
    if (action) action();
  });

  /* ---------- Events ---------- */

  const idOf = (el) => el.closest('.item').dataset.id;

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = els.input.value.trim();
    els.input.value = '';
    if (text) addTodo(text);
    els.input.focus();
  });

  els.filters.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    state.filter = button.dataset.filter;
    state.editingId = null;
    render();
  });

  els.clearDone.addEventListener('click', () => removeTodos((todo) => todo.done));

  els.list.addEventListener('change', (event) => {
    if (event.target.dataset.role === 'check') {
      toggleTodo(idOf(event.target), event.target.checked);
    }
  });

  els.list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-role]');
    if (!button) return;
    const id = idOf(button);
    if (button.dataset.role === 'edit') startEdit(id);
    if (button.dataset.role === 'delete') removeTodos((todo) => todo.id === id);
  });

  els.list.addEventListener('dblclick', (event) => {
    const text = event.target.closest('.text');
    if (text) startEdit(idOf(text));
  });

  els.list.addEventListener('keydown', (event) => {
    // Ignore keys that confirm an IME composition (Korean input), or Enter would fire twice.
    if (!event.target.matches('.edit-input') || event.isComposing) return;
    const id = idOf(event.target);
    if (event.key === 'Enter') {
      event.preventDefault();
      endEdit(id, event.target.value);
    } else if (event.key === 'Escape') {
      endEdit(id, null);
    }
  });

  els.list.addEventListener('focusout', (event) => {
    if (event.target.matches('.edit-input')) {
      endEdit(idOf(event.target), event.target.value, { restoreFocus: false });
    }
  });

  // Keep several open tabs in sync.
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    state.todos = load();
    state.editingId = null;
    hideToast();
    render();
  });

  /* ---------- Init ---------- */

  els.today.dateTime = new Date().toISOString().slice(0, 10);
  els.today.textContent = new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());

  render();

  // Don't pop up the on-screen keyboard on touch devices.
  if (window.matchMedia('(hover: hover)').matches) els.input.focus();
})();

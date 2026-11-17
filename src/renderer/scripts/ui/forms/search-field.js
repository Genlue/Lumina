// Golden Gate · forms/search-field
import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { applyControlState } from '../_shared/control.js';

export function SearchField({
  placeholder = '搜索',
  value = '',
  onInput,
  width = 180,
  label = '',
} = {}) {
  const input = h('input', {
    class: 'c-field__input selectable',
    type: 'text',
    value,
    placeholder,
    'aria-label': label || placeholder || '搜索',
    oninput: (e) => {
      clearBtn.style.display = e.target.value ? 'grid' : 'none';
      onInput?.(e.target.value);
    },
    onkeydown: (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        clearBtn.style.display = 'none';
        onInput?.('');
        input.blur();
      }
    },
  });

  const clearBtn = h('button', {
    class: 'c-iconbtn c-iconbtn--sm',
    type: 'button',
    'aria-label': '清除',
    style: { display: value ? 'grid' : 'none', color: 'var(--text-tertiary)' },
    onclick: () => {
      input.value = '';
      clearBtn.style.display = 'none';
      onInput?.('');
      input.focus();
    },
    html: icon('x-circle', 14),
  });

  const wrap = h(
    'div',
    { class: 'c-field c-search', style: { width } },
    h('span', { class: 'c-field__icon', html: icon('search', 14) }),
    input,
    clearBtn
  );
  wrap.input = input;
  wrap.set = (v) => {
    input.value = v ?? '';
    clearBtn.style.display = input.value ? 'grid' : 'none';
  };
  wrap.value = () => input.value;
  wrap.setDisabled = (v) => {
    applyControlState(input, { disabled: v });
    clearBtn.disabled = !!v;
  };
  wrap.setInvalid = (v) => {
    applyControlState(input, { invalid: v });
    if (v) wrap.dataset.invalid = '1';
    else delete wrap.dataset.invalid;
  };
  wrap.focus = () => input.focus();
  wrap.dispose = () => {};
  return wrap;
}

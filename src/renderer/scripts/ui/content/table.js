// Golden Gate · content/table
import { h } from '../../core/dom.js';
import { iconEl } from '../../core/icons.js';

/* ==========================================================================
   21. 数据表
   ========================================================================== */

/**
 * @param {object} o
 * @param {Array<{key:string,label:string,width?:string,align?:'left'|'right',sortable?:boolean,render?:(row)=>Node|string}>} o.columns
 * @param {Array<object>} o.rows
 * @param {{key:string, dir:'asc'|'desc'}|null} [o.sort]
 * @param {(sort:object)=>void} [o.onSort]
 */
export function Table({
  columns = [],
  rows = [],
  sort = null,
  onSort,
  rowKey = (row, i) => row.id ?? i,
  selectedKey = null,
  onSelect,
  dense = false,
  className = '',
} = {}) {
  const head = h('tr');
  for (const c of columns) {
    const sorted = sort && sort.key === c.key ? sort.dir : null;
    const label = h(
      'span',
      null,
      c.label,
      c.sortable ? iconEl('chevron-down', 11) : null
    );
    const th = h(
      'th',
      {
        style: { width: c.width || null, textAlign: c.align || null },
        'aria-sort': sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : null,
      },
      c.sortable
        ? h(
            'button',
            {
              class: 'c-table__sort',
              type: 'button',
              onclick: () =>
                onSort?.({
                  key: c.key,
                  dir: sorted === 'asc' ? 'desc' : 'asc',
                }),
            },
            c.label,
            iconEl(sorted === 'asc' ? 'chevron-up' : 'chevron-down', 11)
          )
        : label
    );
    head.append(th);
  }

  const body = h('tbody');
  rows.forEach((row, i) => {
    const key = rowKey(row, i);
    const tr = h('tr', {
      'aria-selected': selectedKey === null ? null : String(String(selectedKey) === String(key)),
      onclick: onSelect ? () => onSelect(row, i) : null,
    });
    for (const c of columns) {
      const raw = c.render ? c.render(row) : row[c.key];
      const td = h('td', { class: c.align === 'right' ? 'c-table__num' : '' });
      if (raw instanceof Node) td.append(raw);
      else td.textContent = raw ?? '';
      tr.append(td);
    }
    body.append(tr);
  });

  return h(
    'table',
    { class: `c-table ${dense ? 'c-table--dense' : ''} ${className}`.trim() },
    h('thead', null, head),
    body
  );
}

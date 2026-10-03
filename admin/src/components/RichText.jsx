import { useEffect, useRef, useState } from 'react';
import { Bold, Italic, List, ListOrdered, Heading2, Link2, Code, Underline } from 'lucide-react';
import { cx } from './ui.jsx';

/** Lightweight rich text editor (bold, lists, headings, links) with an HTML view. */
export default function RichText({ value, onChange, minHeight = 160 }) {
  const ref = useRef();
  const [html, setHtml] = useState(false);
  useEffect(() => {
    if (ref.current && !html && ref.current.innerHTML !== (value || '')) ref.current.innerHTML = value || '';
  }, [value, html]);
  const cmd = (name, arg) => {
    ref.current.focus();
    document.execCommand(name, false, arg);
    onChange(ref.current.innerHTML);
  };
  const Btn = ({ icon: Icon, onClick, title, active }) => (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={cx('rounded p-1.5 text-zinc-600 hover:bg-zinc-200', active && 'bg-zinc-200 text-zinc-900')}><Icon size={15} /></button>
  );
  return (
    <div className="overflow-hidden rounded-md border border-zinc-300 focus-within:border-zinc-900 focus-within:ring-1 focus-within:ring-zinc-900">
      <div className="flex gap-0.5 border-b border-zinc-200 bg-zinc-50 p-1">
        <Btn icon={Bold} title="Bold" onClick={() => cmd('bold')} />
        <Btn icon={Italic} title="Italic" onClick={() => cmd('italic')} />
        <Btn icon={Underline} title="Underline" onClick={() => cmd('underline')} />
        <Btn icon={Heading2} title="Heading" onClick={() => cmd('formatBlock', 'h3')} />
        <Btn icon={List} title="Bullet list" onClick={() => cmd('insertUnorderedList')} />
        <Btn icon={ListOrdered} title="Numbered list" onClick={() => cmd('insertOrderedList')} />
        <Btn icon={Link2} title="Link" onClick={() => { const url = prompt('Link address'); if (url) cmd('createLink', url); }} />
        <div className="flex-1" />
        <Btn icon={Code} title="Edit HTML" active={html} onClick={() => setHtml(!html)} />
      </div>
      {html ? (
        <textarea value={value || ''} onChange={(e) => onChange(e.target.value)} style={{ minHeight }} className="block w-full p-3 font-mono text-xs outline-none" />
      ) : (
        <div ref={ref} contentEditable suppressContentEditableWarning onInput={() => onChange(ref.current.innerHTML)}
          style={{ minHeight }} className="prose-lite p-3 outline-none [&_h3]:mb-1 [&_h3]:font-semibold [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5" />
      )}
    </div>
  );
}

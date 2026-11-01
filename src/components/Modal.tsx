import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export default function Modal({title,onClose,busy=false,children}:{title:string;onClose:()=>void;busy?:boolean;children:ReactNode}) {
 const id=useId();const ref=useRef<HTMLElement>(null);const closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;const old=document.body.style.overflow;document.body.style.overflow='hidden';
  const items=()=>Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')||[]);
  (ref.current?.querySelector<HTMLElement>('input,textarea')||items()[0]||ref.current)?.focus();
  function key(e:KeyboardEvent){if(e.key==='Escape'&&!busy)closeRef.current();if(e.key==='Tab'){const list=items();if(!list.length){e.preventDefault();return;}if(e.shiftKey&&document.activeElement===list[0]){e.preventDefault();list.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===list.at(-1)){e.preventDefault();list[0].focus();}}}
  document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);document.body.style.overflow=old;previous?.isConnected&&previous.focus();};
 },[busy]);
 return <div className="modal-backdrop" onClick={()=>!busy&&onClose()}><section ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} onClick={e=>e.stopPropagation()}><button className="close" aria-label="닫기" disabled={busy} onClick={onClose}><X size={20}/></button><h2 id={id}>{title}</h2>{children}</section></div>;
}

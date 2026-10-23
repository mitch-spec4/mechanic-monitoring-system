import { useId } from "react";

export default function Modal({title,icon,onClose,children}:{title:string,icon?:any,onClose:()=>void,children:any}){
  const titleId = useId();
  return (
    <div className="overlay">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modalHead">
          <div className="modalTitle">
            {icon && <span className="modalIcon">{icon}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button className="closeBtn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modalContent">
          {children}
        </div>
      </div>
    </div>
  );
}

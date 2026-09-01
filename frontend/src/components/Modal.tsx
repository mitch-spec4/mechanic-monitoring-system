export default function Modal({title,icon,onClose,children}:{title:string,icon?:any,onClose:()=>void,children:any}){
  return (
    <div className="overlay">
      <div className="modal">
        <div className="modalHead">
          <div className="modalTitle">
            {icon && <span className="modalIcon">{icon}</span>}
            <h2>{title}</h2>
          </div>
          <button className="closeBtn" onClick={onClose}>×</button>
        </div>
        <div className="modalContent">
          {children}
        </div>
      </div>
    </div>
  );
}

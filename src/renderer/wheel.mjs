import {icon,itemIcon} from './icons.mjs';
export const escapeHTML = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const KIND_VERBS={app:'Запустити',folder:'Відкрити папку',script:'Виконати скрипт',system:'Команда Windows',keys:'Натиснути клавіші',text:'Вставити текст',group:'Відкрити групу'};
export function sectorAt(x,y,count,inner=84,outer=230){
  const radius=Math.hypot(x,y);
  if(!count||radius<inner||radius>outer)return -1;
  const step=360/count;
  const angle=((Math.atan2(y,x)*180/Math.PI)+90+step/2+360)%360;
  return Math.floor(angle/step)%count;
}
export function sectorPath(index,count,inner=92,outer=207,gap=6){
  const step=2*Math.PI/count;
  const a=-Math.PI/2+index*step-step/2;
  const b=a+step;
  // Offset both edges from their shared radial boundary by gap / 2.
  // The angular offsets differ so the resulting gutters stay parallel.
  const innerOffset=Math.asin(gap/(2*inner));
  const outerOffset=Math.asin(gap/(2*outer));
  const p=(r,t)=>`${(240+r*Math.cos(t)).toFixed(3)},${(240+r*Math.sin(t)).toFixed(3)}`;
  return `M${p(outer,a+outerOffset)} A${outer},${outer} 0 ${step-2*outerOffset>Math.PI?1:0} 1 ${p(outer,b-outerOffset)} L${p(inner,b-innerOffset)} A${inner},${inner} 0 ${step-2*innerOffset>Math.PI?1:0} 0 ${p(inner,a+innerOffset)} Z`;
}
// The thin arc just outside a sector that fills while a hover launch counts down.
export function sectorArc(index,count,radius=216,gap=6){
  const step=2*Math.PI/count,a=-Math.PI/2+index*step-step/2,b=a+step,offset=Math.asin(gap/(2*radius));
  const p=t=>`${(240+radius*Math.cos(t)).toFixed(3)},${(240+radius*Math.sin(t)).toFixed(3)}`;
  if(count===1)return `M${p(-Math.PI/2)} A${radius},${radius} 0 1 1 ${p(-Math.PI/2+Math.PI)} A${radius},${radius} 0 1 1 ${p(-Math.PI/2+2*Math.PI-0.001)}`;
  return `M${p(a+offset)} A${radius},${radius} 0 ${step-2*offset>Math.PI?1:0} 1 ${p(b-offset)}`;
}
export function renderWheel(container,items,options={}){
  const title=options.title||'Orbit 2';
  // The wheel can end with an extra "+" sector that adds an action in that slot.
  const slot=options.addSlot&&items.length>0,count=items.length+(slot?1:0);
  const slotAngle=(-90+items.length*360/count)*Math.PI/180;
  const subtitle=options.back?'Назад':options.subtitle||`${items.length} ${items.length%10===1&&items.length%100!==11?'дія':[2,3,4].includes(items.length%10)&&![12,13,14].includes(items.length%100)?'дії':'дій'}`;
  container.innerHTML=`<div class="wheel ${options.labels===false?'no-labels':''} ${options.numbers?'show-numbers':''}" role="group" aria-label="Радіальне меню ${escapeHTML(title)}" data-count="${count}">
    <svg class="wheel-sectors" viewBox="0 0 480 480" aria-hidden="true">
      <circle class="wheel-guide" cx="240" cy="240" r="224"/>
      ${items.map((item,i)=>`<path class="wheel-sector ${options.selected===item.id?'selected':''}" data-sector="${escapeHTML(item.id)}" d="${sectorPath(i,count)}"/>`).join('')}
      ${slot?`<path class="wheel-sector wheel-add-sector ${options.addSelected?'selected':''}" data-add-slot d="${sectorPath(items.length,count)}"/>`:''}
      <path class="wheel-arm" pathLength="1" d=""/>
    </svg>
    ${slot?`<button class="wheel-item wheel-add ${options.addSelected?'selected':''}" data-add-slot type="button" style="left:${50+150*Math.cos(slotAngle)/4.8}%;top:${50+150*Math.sin(slotAngle)/4.8}%;--wheel-label-width:${(wheelLabelWidth(slotAngle,count)/4.8).toFixed(3)}cqw;--i:${items.length}" aria-label="${escapeHTML(options.addItem?'Додати '+options.addItem.name:'Додати дію')}">${options.addItem?`<span class="wheel-add-app">${itemIcon(options.addItem,25)}<i>${icon('plus',11)}</i></span>`:icon('plus',22)}<span class="wheel-item-label">${escapeHTML(options.addItem?options.addItem.name:'Додати')}</span></button>`:''}
    ${items.map((item,i)=>{
      const a=(-90+i*360/count)*Math.PI/180,r=150;
      const labelWidth=wheelLabelWidth(a,count);
      return `<button class="wheel-item ${options.selected===item.id?'selected':''}" data-wheel-id="${escapeHTML(item.id)}" data-index="${i}" style="left:${50+r*Math.cos(a)/4.8}%;top:${50+r*Math.sin(a)/4.8}%;--wheel-label-width:${(labelWidth/4.8).toFixed(3)}cqw;--i:${i}" title="${escapeHTML(item.name)}" aria-label="${escapeHTML(item.name)}${item.kind==='group'?(item.target==='sequence'?', послідовність':', група'):''}">
       ${itemIcon(item,25)}<span class="wheel-item-label">${escapeHTML(item.name)}</span>${item.kind==='group'?(item.target==='sequence'?'<i class="group-indicator sequence">▸▸</i>':'<i class="group-indicator">···</i>'):''}${i<9?`<i class="wheel-num" aria-hidden="true">${i+1}</i>`:''}
      </button>`;
    }).join('')}
    <button class="wheel-center" aria-label="${options.back?'Назад':escapeHTML(title)+', '+items.length+' дій'}" ${options.back?'data-wheel-back':''} data-default-title="${escapeHTML(title)}" data-default-sub="${escapeHTML(subtitle)}">
      <span class="wheel-center-icon">${icon(options.back?'back':'orbit',options.back?24:30)}</span>
      <strong data-center-title>${escapeHTML(title)}</strong><small data-center-sub>${escapeHTML(subtitle)}</small>
    </button>
    ${items.length===0?(options.addSlot?'<button class="wheel-empty" data-add-slot type="button">Додайте першу дію</button>':'<span class="wheel-empty">Додайте першу дію</span>'):''}
  </div>`;
}

// Shows the hovered action in the center, or restores the wheel's own title.
export function setWheelCenter(container,item){
  const center=container.querySelector('.wheel-center');if(!center)return;
  const title=center.querySelector('[data-center-title]'),sub=center.querySelector('[data-center-sub]');
  center.classList.toggle('previewing',!!item);
  title.textContent=item?item.name:center.dataset.defaultTitle;
  sub.textContent=item?(item.kind==='add'?'Додати дію':item.kind==='group'&&item.target==='sequence'?'Виконати всі по черзі':KIND_VERBS[item.kind]||''):center.dataset.defaultSub;
}

// Fills the arc around a sector over `ms` milliseconds; index -1 clears it.
export function armSector(container,index,count,ms){
  const arm=container.querySelector('.wheel-arm');if(!arm)return;
  arm.classList.remove('arming');
  if(index<0||!count||!ms){arm.setAttribute('d','');return;}
  arm.setAttribute('d',sectorArc(index,count));
  arm.style.setProperty('--arm-ms',ms+'ms');
  void arm.getBoundingClientRect();
  arm.classList.add('arming');
}

function wheelLabelWidth(angle,count){
  if(count<3)return 104;
  const x=150*Math.cos(angle),y=150*Math.sin(angle),half=Math.PI/count;
  const start=angle-half,end=angle+half;
  // Keep all four label corners inside their sector with room for its gutter.
  const fits=width=>[-width/2,width/2].every(dx=>[0,28].every(dy=>{
    const px=x+dx,py=y+dy;
    return Math.cos(start)*py-Math.sin(start)*px>=3 && px*Math.sin(end)-py*Math.cos(end)>=3;
  }));
  let low=0,high=84;
  for(let iteration=0;iteration<12;iteration++){const middle=(low+high)/2;if(fits(middle))low=middle;else high=middle;}
  return low;
}

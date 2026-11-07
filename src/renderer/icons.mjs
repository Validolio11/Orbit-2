// Repeat one tooth at 60-degree intervals instead of accumulating relative segments.
const gearPoint = (radius, degrees) => {
  const angle = degrees * Math.PI / 180;
  return `${(12 + radius * Math.cos(angle)).toFixed(3)},${(12 + radius * Math.sin(angle)).toFixed(3)}`;
};
const settingsOutline = Array.from({length:6},(_,index)=>{
  const angle=-90+index*60;
  return `${index?'L':'M'}${gearPoint(7.5,angle-22)} L${gearPoint(10,angle-11)} L${gearPoint(10,angle+11)} L${gearPoint(7.5,angle+22)} A7.5 7.5 0 0 1 ${gearPoint(7.5,angle+38)}`;
}).join(' ')+' Z';

const paths = {
  orbit:'<ellipse cx="12" cy="12" rx="9" ry="4.5" transform="rotate(-40 12 12)"/><circle cx="12" cy="12" r="3"/><circle cx="18.9" cy="6.2" r="1.3" fill="currentColor" stroke="none"/>',
  wheel:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6m0 6v6M3 12h6m6 0h6M5.6 5.6l4.3 4.3m4.2 4.2 4.3 4.3M5.6 18.4l4.3-4.3m4.2-4.2 4.3-4.3"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  mouse:'<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M6 9h12m-6-7v7M4 8v5"/>',
  settings:`<path d="${settingsOutline}"/><circle cx="12" cy="12" r="3"/>`,
  plus:'<path d="M12 5v14M5 12h14"/>',
  play:'<path d="m9 5 11 7-11 7z"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>',
  down:'<path d="m6 9 6 6 6-6"/>',
  back:'<path d="m14 5-7 7 7 7M7 12h14"/>',
  folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z"/>',
  app:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 8h18M7 5.5h.01m3 0h.01"/>',
  script:'<path d="m8 6-5 6 5 6m8-12 5 6-5 6m-3-15-2 18"/>',
  system:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  group:'<path d="M3 6h7l2 2h9v13H3zM3 3h7l2 2h9"/>',
  browser:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  screenshot:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/><rect x="7" y="7" width="10" height="10" rx="1"/>',
  volume:'<path d="M11 4 6 8H3v8h3l5 4zM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  tasks:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 16v-4m5 4V7m5 9v-6"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
  moon:'<path d="M21 13.5A9 9 0 0 1 10.5 3 9 9 0 1 0 21 13.5Z"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  minus:'<path d="M5 12h14"/>',
  edit:'<path d="m15 5 4 4M4 20l4-1L21 6l-4-4L4 15z"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 4V3H3v13h1"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/>',
  drag:'<circle cx="9" cy="5" r=".8"/><circle cx="15" cy="5" r=".8"/><circle cx="9" cy="12" r=".8"/><circle cx="15" cy="12" r=".8"/><circle cx="9" cy="19" r=".8"/><circle cx="15" cy="19" r=".8"/>',
  arrowUp:'<path d="m6 10 6-6 6 6m-6-6v16"/>',
  moveRoot:'<path d="M14 4h6v6m0-6-9 9M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  arrowDown:'<path d="m6 14 6 6 6-6m-6 6V4"/>',
  import:'<path d="M3 15v6h18v-6M12 3v12m-5-5 5 5 5-5"/>',
  export:'<path d="M3 15v6h18v-6M12 15V3m-5 5 5-5 5 5"/>',
  keyboard:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01m4 0h.01m4 0h.01m4 0h.01M6 12h.01m4 0h.01m4 0h.01m4 0h.01M7 16h10"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  external:'<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  pause:'<path d="M8 5v14m8-14v14"/>',
  volumeMute:'<path d="M11 4 6 8H3v8h3l5 4zM16 9l5 6m0-6-5 6"/>',
  volumeUp:'<path d="M11 4 6 8H3v8h3l5 4zM15 12h6m-3-3v6"/>',
  volumeDown:'<path d="M11 4 6 8H3v8h3l5 4zM15 12h6"/>',
  desktop:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M7 13h4"/>',
  lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  playPause:'<path d="m3 6 8 6-8 6zM16 6v12m4-12v12"/>',
  trackPrev:'<path d="M6 5v14m13-13-9 6 9 6z"/>',
  trackNext:'<path d="M18 5v14M5 6l9 6-9 6z"/>',
  sliders:'<path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  run:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18M7 12l3 2.5L7 17m5 0h4"/>',
  windows:'<rect x="3" y="7" width="13" height="11" rx="1.5"/><path d="M8 7V4.5A1.5 1.5 0 0 1 9.5 3h10A1.5 1.5 0 0 1 21 4.5v9a1.5 1.5 0 0 1-1.5 1.5H16"/>',
  clipboard:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6m-6 4h6m-6 4h3"/>',
  emoji:'<circle cx="12" cy="12" r="9"/><path d="M8 14a5 5 0 0 0 8 0M9 9.5h.01m6 0h.01"/>',
  mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v3"/>',
  bell:'<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
  bluetooth:'<path d="m7 7 10 10-5 4V3l5 4L7 17"/>',
  calculator:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8v3H8zM8 14h.01m4 0h.01m4 0h.01M8 17.5h.01m4 0h.01m4 0h.01"/>',
  notepad:'<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 11h7m-7 3h7m-7 3h4"/>',
  image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  film:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4m10 0h4M3 15h4m10 0h4"/>',
  music:'<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  home:'<path d="M3 11 12 4l9 7v9H3z"/><path d="M10 20v-6h4v6"/>',
  cloud:'<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9z"/>',
  drive:'<rect x="3" y="13" width="18" height="7" rx="2"/><path d="M5 13 7.5 5h9L19 13M17 16.5h.01"/>',
  briefcase:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 12h18"/>',
  palette:'<path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A4.7 4.7 0 0 0 21 9.6C21 5.9 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  gamepad:'<path d="M7 8h10a4 4 0 0 1 4 4l.6 4.2a2 2 0 0 1-3.6 1.4L16 15H8l-2 2.6a2 2 0 0 1-3.6-1.4L3 12a4 4 0 0 1 4-4z"/><path d="M8 11v2m-1-1h2m6.5-.5h.01m2 1.5h.01"/>',
  star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  // Group icons.
  heart:'<path d="M12 20s-8-4.9-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6.1-8 11-8 11z"/>',
  bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',
  users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7m2 2.5a6.5 6.5 0 0 1 3.5 6"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4m8-4v4"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  chat:'<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8m-8 3h5"/>',
  phone:'<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  layers:'<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5M3 17l9 5 9-5"/>',
  cube:'<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  camera:'<path d="M3 8a2 2 0 0 1 2-2h2.5L9 4h6l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
  video:'<rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/>',
  tv:'<rect x="3" y="6" width="18" height="13" rx="2"/><path d="m8 2 4 4 4-4M9 22h6"/>',
  headphones:'<path d="M4 18v-6a8 8 0 0 1 16 0v6"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>',
  trophy:'<path d="M8 4h8v6a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4m8-4h3a3 3 0 0 1-3 4M12 14v4m-4 3h8l-1-3H9z"/>',
  wifi:'<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01"/>',
  map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15m6-12v15"/>',
  sparkles:'<path d="M11 3c.5 4 2 5.5 6 6-4 .5-5.5 2-6 6-.5-4-2-5.5-6-6 4-.5 5.5-2 6-6z"/><path d="M18.5 14c.2 1.6.8 2.3 2.5 2.5-1.7.2-2.3.9-2.5 2.5-.2-1.6-.8-2.3-2.5-2.5 1.7-.2 2.3-.9 2.5-2.5zM5.5 16c.2 1.2.6 1.7 1.8 1.8-1.2.2-1.6.6-1.8 1.8-.2-1.2-.6-1.6-1.8-1.8 1.2-.1 1.6-.6 1.8-1.8z"/>',
  bot:'<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4M9 13h.01m6 0h.01M9.5 16.5h5M2 13v3m20-3v3"/><circle cx="12" cy="3.5" r=".8"/>',
  cpu:'<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5" rx=".5"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>',
  database:'<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  server:'<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01M11 7.5h6m-6 9h6"/>',
  zap:'<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  rocket:'<path d="M12 15 9 12c2-5.5 6-8.5 12-9-.5 6-3.5 10-9 12z"/><path d="M9 12H5l2-3h4.5M12 15v4l3-2v-4.5M7 17c-2 0-3 1.5-3 3 1.5 0 3-1 3-3z"/>',
  shield:'<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  key:'<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-4 4 3 3m-5-1 2 2"/>',
  book:'<path d="M4 19V5a2 2 0 0 1 2-2h14v14H6a2 2 0 0 0-2 2 2 2 0 0 0 2 2h14M8 7h8"/>',
  graduation:'<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5M22 9v6"/>',
  chart:'<path d="M4 4v16h16"/><path d="m8 15 4-4 3 3 5-6"/>',
  wallet:'<path d="M18 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6"/><path d="M16 14h.01"/>',
  cart:'<path d="M3 4h2l2.5 11h11L21 8H6.5"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/>',
  box:'<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>',
  printer:'<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  flask:'<path d="M9 3h6m-5 0v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10"/>',
  leaf:'<path d="M5 19C5 10 10 5 20 4c-1 10-6 15-15 15z"/><path d="m5 19 8-8"/>',
  coffee:'<path d="M4 9h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17M8 3v3m4-3v3"/>',
  gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8C11 5 7 3 6 5.5S9 8 12 8zm0 0c1-3 5-5 6-2.5S15 8 12 8z"/>',
  tag:'<path d="M3 12V3h9l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  keys:'<rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  text:'<path d="M4 6h16M4 11h16M4 16h10"/><path d="m17 16 2 2 3-4"/>',
  undo:'<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo:'<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  select:'<path d="M4 8V5a1 1 0 0 1 1-1h3m8 0h3a1 1 0 0 1 1 1v3m0 8v3a1 1 0 0 1-1 1h-3m-8 0H5a1 1 0 0 1-1-1v-3"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  save:'<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
  windowClose:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18M10 12l4 4m0-4-4 4"/>',
  windowMin:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18M8 15h8"/>',
  windowMax:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18"/><rect x="8" y="11" width="8" height="5" rx="1"/>',
  desktopNext:'<rect x="2" y="5" width="13" height="10" rx="1.5"/><path d="M6 19h5M18 8l3 3-3 3M15 11h6"/>',
  desktopPrev:'<rect x="9" y="5" width="13" height="10" rx="1.5"/><path d="M13 19h5M6 8l-3 3 3 3M9 11H3"/>',
  command:'<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
  history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 3"/>',
  link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  launch:'<path d="M5 19 19 5M9 5h10v10"/>',
  overview:'<rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="11" width="8" height="10" rx="1.5"/><rect x="3" y="15" width="8" height="6" rx="1.5"/>',
};
export const systemIcons={explorer:'folder','task-manager':'tasks',screenshot:'screenshot',mute:'volumeMute','volume-up':'volumeUp','volume-down':'volumeDown',desktop:'desktop',settings:'settings',lock:'lock','media-play':'playPause',
  'control-panel':'sliders','recycle-bin':'trash',search:'search',run:'run','task-view':'windows',clipboard:'clipboard',emoji:'emoji',dictation:'mic',notifications:'bell',
  'sound-settings':'volume',bluetooth:'bluetooth','media-prev':'trackPrev','media-next':'trackNext',calculator:'calculator',notepad:'notepad','close-window':'windowClose','minimize-window':'windowMin','maximize-window':'windowMax','desktop-next':'desktopNext','desktop-prev':'desktopPrev'};
export function icon(name,size=20){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.app}</svg>`;}
function fallbackItemIcon(item,size=22){
  const n = (item.name||'').toLowerCase();
  const adobe = n.includes('illustrator')?['Ai','ai']:n.includes('after effects')?['Ae','ae']:n.includes('photoshop')?['Ps','ps']:n==='adobe'?['A','adobe']:null;
  if(adobe)return `<span class="adobe-icon ${adobe[1]}" style="--icon-size:${size}px">${adobe[0]}</span>`;
  const guessed = item.kind==='system'&&systemIcons[item.target]?systemIcons[item.target]:/browser/i.test(item.icon)||/браузер|browser|chrome|edge|вебпошук/.test(n)?'browser':item.kind;
  const aliases={globe:'browser',files:'folder',activity:'tasks'};
  return icon(paths[item.icon]?item.icon:aliases[item.icon]||guessed,size);
}

const appIconCache=new Map(),appIconRequests=new Map();
const attribute=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function rememberAppIcon(target,data){
  if(typeof target==='string'&&typeof data==='string'&&data.startsWith('data:image/png;base64,')&&data.length<200000)appIconCache.set(target,data);
}
export function itemIcon(item,size=22){
  const fallback=fallbackItemIcon(item,size);
  if(item.kind!=='app'||!item.target)return fallback;
  const data=appIconCache.get(item.target);
  return `<span class="app-icon-slot" data-app-icon-target="${attribute(item.target)}" style="--app-icon-size:${size}px">${data?`<img src="${data}" alt="" draggable="false">`:fallback}</span>`;
}
export function hydrateAppIcons(root=document){
  const targets=new Set([...root.querySelectorAll('[data-app-icon-target]')].map(node=>node.dataset.appIconTarget));
  const apply=target=>{
    const data=appIconCache.get(target);if(!data)return;
    for(const node of document.querySelectorAll('[data-app-icon-target]'))if(node.dataset.appIconTarget===target&&!node.querySelector('img')){
      const image=document.createElement('img');image.src=data;image.alt='';image.draggable=false;node.replaceChildren(image);
    }
  };
  for(const target of targets){
    if(appIconCache.has(target)){apply(target);continue;}
    if(appIconRequests.has(target)||!window.orbit?.getAppIcon)continue;
    const request=window.orbit.getAppIcon(target).then(data=>{if(data)rememberAppIcon(target,data);else appIconCache.set(target,null);apply(target);}).catch(()=>{appIconCache.set(target,null);}).finally(()=>appIconRequests.delete(target));
    appIconRequests.set(target,request);
  }
}

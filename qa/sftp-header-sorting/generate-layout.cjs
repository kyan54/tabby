const fs=require('fs'),path=require('path');
const root=process.cwd();const req=x=>require(path.join(root,'node_modules',x));
const pug=req('pug'),sass=req('sass');
const source=fs.readFileSync('tabby-ssh/src/components/sftpPanel.component.pug','utf8');
const lines=source.split('\n');const start=lines.findIndex(x=>x.includes('.file-table-scroll'));const end=lines.findIndex((x,i)=>i>start&&x.startsWith('        .alert.alert-info'));
const table=pug.render(lines.slice(start,end).map(x=>x.slice(8)).join('\n'));
const css=sass.compileString(fs.readFileSync('tabby-ssh/src/components/sftpPanel.component.scss','utf8').replaceAll(':host','.panel')).css;
const html=`<!doctype html><meta charset="utf-8"><style>
body{font:14px system-ui;margin:16px;background:#f7f7f7;color:#212529}body.dark{background:#20242a;color:#e5e7eb;--bs-border-color:#495057}.panel{height:auto!important;border:1px solid #888;border-radius:6px;padding:12px;margin:16px 0}.panel.narrow{width:360px}button{font:inherit}.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}h2{margin:8px 0;font-size:16px}.advanced{color:inherit;background:none;border:0;margin:0 0 10px;cursor:pointer}${css}</style>
<h2>Fake data only · production table markup and stylesheet</h2><div class="panel"><button class="advanced">▸ Advanced sorting</button>${table}</div><div class="panel narrow"><button class="advanced">▸ Advanced sorting</button>${table}</div>
<script>
if(location.hash==='#dark')document.body.classList.add('dark');
const fixtures=[['Go up','','',''],['📁 archives','','Folder','2026-10-18 08:00'],['📁 project','','Folder','2026-10-17 11:02'],['notes.txt','1.2 KB','.txt','2026-10-18 08:04'],['report-with-a-very-long-file-name.json','56 KB','.json','2026-10-17 16:24'],['README','640 B','File','2026-10-16 12:00']];
for(const table of document.querySelectorAll('table')){
 table.querySelector('thead tr').innerHTML=['Name','Size','Type','Modified'].map((label,i)=>'<th scope="col" '+(i===3?'aria-sort="descending"':'')+'><button class="sort-heading">'+label+(i===3?'<span class="sort-indicator">↓1</span>':i===1?'<span class="sort-indicator">↑2</span>':'')+'</button></th>').join('');
 const parent=table.querySelector('.parent-row'),file=table.querySelector('.file-row');const body=table.tBodies[0];body.innerHTML='';fixtures.forEach((row,i)=>{const clone=(i?file:parent).cloneNode(true);[...clone.cells].forEach((cell,c)=>{if(c===0){cell.innerHTML='<button type="button" class="file-name"><span></span></button>';cell.querySelector('span').textContent=row[c]}else cell.textContent=row[c]});body.append(clone)});
}
for(const el of document.querySelectorAll('*'))for(const attr of [...el.attributes])if(/^[*[(]/.test(attr.name))el.removeAttribute(attr.name);
window.layoutChecks=[...document.querySelectorAll('table')].map(table=>({columns:table.rows[0].cells.length,parentFirst:table.tBodies[0].rows[0].textContent.includes('Go up'),aligned:[...table.rows].every(row=>row.cells.length===4),tableWidth:table.getBoundingClientRect().width,scrollWidth:table.parentElement.scrollWidth,viewportWidth:table.parentElement.clientWidth}));
const result=document.createElement('pre');result.id='layout-checks';result.style.display='none';result.textContent=JSON.stringify(window.layoutChecks);document.body.append(result);
</script>`;
fs.mkdirSync('qa/sftp-header-sorting',{recursive:true});fs.writeFileSync('qa/sftp-header-sorting/layout.html',html);

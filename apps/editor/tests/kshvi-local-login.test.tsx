// @vitest-environment happy-dom
import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {KshviView} from '../src/modern/kshvi/KshviView';
import {ExerciseClient} from '../src/modern/kshvi/kshvi-api';
afterEach(()=>{cleanup();localStorage.clear();sessionStorage.clear();});
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
it('при 401 получает локальную сессию, повторно читает серверного участника и не показывает форму',async()=>{
 let logged=false;const client=new ExerciseClient({fetch:async(input)=>{
  const url=String(input);const participant={userId:'local-user',activeRole:'DIRECTOR',authorities:['exercise:read'],organizationId:'org',localMode:true};
  if(url.endsWith('/auth/me'))return logged?json(participant):json({error:{message:'Требуется вход'}},401);
  if(url.endsWith('/auth/local')){logged=true;return json({csrfToken:'csrf',participant,roles:[],mode:'LOCAL'});}
  return json({items:[]});
 }});
 render(<KshviView client={client}/>);
 expect(screen.queryByLabelText('Имя пользователя')).toBeNull();
 expect(await screen.findByText('Локальный режим · local-user · Руководитель учения')).toBeTruthy();
 expect(screen.queryByLabelText('Имя пользователя')).toBeNull();
});
it('сетевой 404 оставляет обязательную форму входа',async()=>{
 const client=new ExerciseClient({fetch:async(input)=>String(input).endsWith('/auth/me')?json({error:{message:'Требуется вход'}},401):json({error:{message:'Не найдено'}},404)});
 render(<KshviView client={client}/>);expect(await screen.findByLabelText('Имя пользователя')).toBeTruthy();
});
it('после передачи устройства не входит автоматически при перезагрузке',async()=>{
 sessionStorage.setItem('def_ops.kshvi.handover','1');let logged=false;
 const participant={userId:'local-user',activeRole:'DIRECTOR',authorities:['exercise:read'],organizationId:'org',localMode:true};
 const client=new ExerciseClient({fetch:async(input)=>{
  const url=String(input);
  if(url.endsWith('/auth/me'))return logged?json(participant):json({error:{message:'Требуется вход'}},401);
  if(url.endsWith('/auth/local')){logged=true;return json({csrfToken:'csrf',participant,roles:[]});}
  return json({items:[]});
 }});
 render(<KshviView client={client}/>);expect(await screen.findByLabelText('Имя пользователя')).toBeTruthy();expect(screen.queryByText('Локальный режим · local-user · Руководитель учения')).toBeNull();
});
it('после открытия нового окна восстанавливает CSRF для сохранившейся локальной cookie-сессии',async()=>{
 const participant={userId:'local-user',activeRole:'DIRECTOR',authorities:['exercise:read'],organizationId:'org',localMode:true};
 const client=new ExerciseClient({fetch:async(input,init)=>{
  const url=String(input);
  if(url.endsWith('/auth/me'))return json(participant);
  if(url.endsWith('/auth/local'))return json({csrfToken:'renewed-local-csrf',participant,roles:[]});
  if(init?.method==='POST'&&url.endsWith('/exercises'))return new Headers(init.headers).get('X-CSRF-Token')==='renewed-local-csrf'?json({id:'saved',title:'Сохранённое учение'}):json({error:{message:'CSRF'}},403);
  return json({items:[]});
 }});
 render(<KshviView client={client}/>);
 await screen.findByText('Локальный режим · local-user · Руководитель учения');
 await expect(client.create({title:'Сохранённое учение',purpose:'planned',scale:'tactical'})).resolves.toMatchObject({id:'saved'});
});

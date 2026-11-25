import {expect,it} from 'vitest';
import {createService} from '@def-ops/service-kit';
import {SessionManager,InMemorySessionStore,assertCsrf} from '../src/auth/sessions';
import {localLoginConfig} from '../src/auth/local-login';
import {buildRouter} from '../src/app';
const role={id:'local-role',role:'DIRECTOR',sideId:null,authorities:['exercise:read']};
async function setup(){const store=new InMemorySessionStore(),sessions=new SessionManager({store});await sessions.createAccount({userId:'local-user',username:'local',password:'secret123',organizationId:'org',roles:[role]});return {store,sessions};}
const config=()=>localLoginConfig({KSHVI_LOCAL_AUTOLOGIN:'1',KSHVI_SINGLE_MACHINE:'1',HOST:'127.0.0.1',KSHVI_LOCAL_USER_ID:'local-user',KSHVI_LOCAL_ROLE_ID:'local-role',KSHVI_LOCAL_ORIGINS:'http://127.0.0.1:5173'});
it('создаёт обычную серверную сессию для назначенной роли без ослабления CSRF и отзыва',async()=>{
 const {store,sessions}=await setup();const login=await sessions.loginLocal('local-user','local-role');
 expect(login.cookie).toContain('HttpOnly');expect(login.cookie).toContain('SameSite=Strict');
 expect(login.participant.activeRole).toBe('DIRECTOR');expect(login.participant.authorities).toEqual(['exercise:read']);
 expect(()=>assertCsrf(login.participant,login.csrfToken)).not.toThrow();
 expect(JSON.stringify(store.records())).not.toContain(login.token);
 await sessions.revoke(login.token);await expect(sessions.authenticate(login.token)).rejects.toThrow('401');
 const count=store.records().length;await expect(sessions.loginLocal('local-user','foreign-role')).rejects.toThrow('403');expect(store.records()).toHaveLength(count);
 await sessions.setAccountState('local-user','BLOCKED');await expect(sessions.loginLocal('local-user','local-role')).rejects.toThrow('401');
});
it('маршрут берёт пользователя и роль только из серверной конфигурации',async()=>{
 const {sessions}=await setup();const service=createService({name:'local-login-test',port:0,router:buildRouter({sessions,localLogin:config()})});const port=await service.listen();const base=`http://127.0.0.1:${port}`;
 try{
  const result=await fetch(base+'/kshvi/auth/local',{method:'POST',headers:{origin:'http://127.0.0.1:5173','content-type':'application/json'},body:JSON.stringify({userId:'attacker',roleId:'admin',authorities:['kshvi:admin']})});
  expect(result.status).toBe(200);const body=await result.json();expect(body.participant).toMatchObject({userId:'local-user',activeRole:'DIRECTOR',authorities:['exercise:read']});
  const me=await fetch(base+'/kshvi/auth/me',{headers:{cookie:result.headers.get('set-cookie')!.split(';')[0]}});expect(await me.json()).toMatchObject({userId:'local-user',localMode:true});
  expect((await fetch(base+'/kshvi/auth/local',{method:'POST',headers:{origin:'https://foreign.example'}})).status).toBe(404);
 }finally{await service.close();}
});
it('не включает маршрут в сетевом и неявном официальном режиме',()=>{
 expect(localLoginConfig({KSHVI_LOCAL_AUTOLOGIN:'1',HOST:'0.0.0.0'})).toBeNull();
 expect(localLoginConfig({KSHVI_LOCAL_AUTOLOGIN:'1',KSHVI_MODE:'official',HOST:'127.0.0.1'})).toBeNull();
 expect(buildRouter({sessions:new SessionManager({store:new InMemorySessionStore()}),localLogin:null}).match('POST','/kshvi/auth/local')).toBeNull();
});

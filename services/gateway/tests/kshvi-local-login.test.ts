import {expect,it} from 'vitest';
import {createService} from '@def-ops/service-kit';
import {SessionManager,InMemorySessionStore} from '../../kshvi/src/auth/sessions';
import {buildRouter} from '../../kshvi/src/app';
import {localKshviLoginAllowed,createGateway,parseKeys} from '../src/gateway';
import type {IncomingMessage} from 'node:http';
const request=(ip:string)=>({socket:{remoteAddress:ip},headers:{'x-forwarded-for':'127.0.0.1',origin:'http://127.0.0.1:8080'}} as unknown as IncomingMessage);
it('не проводит автоматический вход извне и через сетевой шлюз, несмотря на клиентские заголовки',()=>{
 expect(localKshviLoginAllowed(request('198.51.100.7'),{localOnly:true})).toBe(false);
 expect(localKshviLoginAllowed(request('127.0.0.1'),{localOnly:false})).toBe(false);
 expect(localKshviLoginAllowed(request('127.0.0.1'),{localOnly:true})).toBe(true);
 expect(localKshviLoginAllowed(request('::ffff:127.0.0.1'),{localOnly:true})).toBe(true);
});
it('сетевой шлюз возвращает 404, даже когда локальный backend умеет создавать сессию',async()=>{
 const sessions=new SessionManager({store:new InMemorySessionStore()});
 await sessions.createAccount({userId:'local',username:'local',password:'secret123',organizationId:'org',roles:[{id:'r',role:'DIRECTOR',sideId:null,authorities:['exercise:read']}]});
 const service=createService({name:'local-backend',port:0,router:buildRouter({sessions,localLogin:{userId:'local',roleId:'r',origins:['http://127.0.0.1:5173']}})}),port=await service.listen();
 try{
  for(const localOnly of [false,true]){
   const gateway=createGateway({port:0,services:{kshvi:`http://127.0.0.1:${port}`},routes:[['/api/kshvi','kshvi','/kshvi']],auth:'open',apiKeys:parseKeys(''),corsOrigin:'*',localOnly,downloadsDev:true});
   await new Promise<void>(resolve=>gateway.listen(0,'127.0.0.1',resolve));
   try{
    const address=gateway.address();if(!address||typeof address==='string')throw Error('Нет порта');
    const response=await fetch(`http://127.0.0.1:${address.port}/api/kshvi/auth/local`,{method:'POST',headers:{origin:'http://127.0.0.1:5173','x-forwarded-for':'127.0.0.1','content-type':'application/json'},body:'{}'});
    expect(response.status).toBe(localOnly?200:404);await response.arrayBuffer();
   }finally{await new Promise<void>(resolve=>gateway.close(()=>resolve()));}
  }
 }finally{await service.close();}
});

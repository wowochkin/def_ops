import {HttpError,reply,type Router} from '@def-ops/service-kit';
import {isLoopback,type LocalLoginConfiguration} from '../auth/local-login';
import {publicParticipant,type SessionManager} from '../auth/sessions';
export function registerLocalAuthRoutes(router:Router,sessions:SessionManager,config:LocalLoginConfiguration|null){
 if(!config)return;
 router.post('/kshvi/auth/local',async ctx=>{
  if(!isLoopback(ctx.req.socket.remoteAddress)||!config.origins.includes(String(ctx.req.headers.origin??'')))throw new HttpError(404,'not_found','Маршрут не найден');
  const login=await sessions.loginLocal(config.userId,config.roleId);
  return reply(200,{mode:'LOCAL',csrfToken:login.csrfToken,participant:{...publicParticipant(login.participant),localMode:true},roles:login.roles},{'Set-Cookie':login.cookie});
 });
}

export type HomeHero = "light" | "classic";

/** Auth returns belong to the classic native-terminal flow, never a second demo. */
export function homeHero(search:string,nativeAuthResult?:string,initialView?:string):HomeHero {
  if(initialView==="classic")return "classic";
  if(nativeAuthResult==="success"||nativeAuthResult==="error")return "classic";
  return new URLSearchParams(search).get("hero")==="classic"?"classic":"light";
}

export function heroSearch(search:string,hero:HomeHero) {
  const params=new URLSearchParams(search);
  if(hero==="classic")params.set("hero","classic");
  else params.delete("hero");
  const query=params.toString();
  return query?`?${query}`:"";
}

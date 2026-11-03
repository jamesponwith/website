import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { SITE } from "../../../../lib/site";
import { desktopFirstOpen, installTargets, iosDownload, runeDownload, runeInstall, type InstallTarget } from "../../../../lib/install";
import { initialPhone, phones, wireBetaRequest, type Phone } from "../../../../lib/beta";
import type { HookMoment } from "./install-hook";
import "../../../../styles/mobile-access.css";

const canShare = () => typeof navigator!=="undefined" && typeof navigator.share==="function" && matchMedia("(hover: none)").matches;

function BetaRequest({phone,onSwitch}:{phone:Phone;onSwitch:()=>void}) {
  const form=useRef<HTMLFormElement>(null),note=useRef<HTMLSpanElement>(null);
  useEffect(()=>wireBetaRequest(form.current,note.current),[]);
  const copy=phones[phone];
  return <div className="mobile-access install-hook-mobile" data-mobile-access>
    <a className="testflight-link" data-testflight-link href={iosDownload} target="_top" hidden={phone!=="ios"}>Open TestFlight <span aria-hidden="true">↗</span></a>
    <details data-email-invite open={phone==="android"}>
    <summary>{phone==="ios"?"Email an invite instead":"Request Google Play access"}</summary>
    <form ref={form} className="install-hook-line install-hook-request" data-phone={phone}>
      <input type="email" name="email" required autoComplete="email" inputMode="email" enterKeyHint="send" autoCapitalize="none" spellCheck={false} placeholder={copy.placeholder} aria-label={copy.field}/>
      <input className="install-hook-trap" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"/>
      <button type="submit" aria-label="Request access">↵</button>
    </form>
    <p className="install-hook-status">
      <span ref={note} role="status" aria-live="polite"/>
      <button type="button" className="install-hook-alt" onClick={()=>{if(note.current)note.current.textContent="";onSwitch();}}>{phones[copy.other].label} instead</button>
    </p>
    </details>
  </div>;
}

/** Install controls; explanatory detail stays in the installation guide. */
export default function InstallHook({moment,onCopy,hookRef,copyRef}:{moment:HookMoment;onCopy:()=>void;hookRef:RefObject<HTMLElement|null>;copyRef:RefObject<HTMLButtonElement|null>}) {
  const [target,setTarget]=useState<InstallTarget>(installTargets[0]);
  // Rendered as iPhone first, then the visitor's own phone once hydrated.
  const [phone,setPhone]=useState<Phone>("ios");
  const [status,setStatus]=useState("");
  const [copied,setCopied]=useState(false);
  const code=useRef<HTMLElement>(null);
  const reset=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>()=>clearTimeout(reset.current),[]);
  useEffect(()=>setPhone(initialPhone()),[]);
  const mobile=target.id==="mobile",desktop=target.id==="rune";
  const command=target.command;
  const label=(item:InstallTarget)=>item.id==="mobile"?phones[phone].label:item.label;
  const choose=(next:InstallTarget)=>{setTarget(next);setStatus("");setCopied(false);};
  const step=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
    const delta=event.key==="ArrowRight"?1:event.key==="ArrowLeft"?-1:0;
    if(!delta)return;
    event.preventDefault();
    const next=installTargets[(index+delta+installTargets.length)%installTargets.length];
    choose(next);
    (event.currentTarget.parentElement?.children[installTargets.indexOf(next)] as HTMLElement|undefined)?.focus();
  };
  const copy=async(text:string)=>{
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);setStatus("Copied.");onCopy();
      clearTimeout(reset.current);reset.current=setTimeout(()=>setCopied(false),1800);
    } catch {
      // Leave the whole command selected so ⌘C / long-press still works.
      if(code.current)getSelection()?.selectAllChildren(code.current);
      setStatus(desktop?runeInstall:"Press ⌘C / Ctrl+C to copy.");
    }
  };
  // From a phone, the computer is the real destination: send it the command or the download.
  const share=async()=>{
    try {await navigator.share(desktop?{title:"Phux Rune for Mac",url:new URL(runeDownload,SITE.url).href}:{title:"Install phux",text:command,url:SITE.url});onCopy();}
    catch {/* The visitor dismissed the share sheet. */}
  };
  return <section ref={hookRef} className="install-hook" data-moment={moment} aria-label="Install phux">
    <div className="install-hook-tabs" role="group" aria-label="Choose an install">
      {installTargets.map((item,index)=><button key={item.id} type="button" aria-pressed={item.id===target.id} onClick={()=>choose(item)} onKeyDown={event=>step(event,index)}>{label(item)}</button>)}
    </div>
    {mobile?<BetaRequest phone={phone} onSwitch={()=>setPhone(phones[phone].other)}/>:desktop?<>
      <div className="install-hook-line install-hook-download">
        <span className="install-hook-prompt" aria-hidden="true">↓</span>
        <span className="install-hook-what">Phux for Apple-silicon Mac</span>
        <a className="install-hook-copy" href={runeDownload} onClick={onCopy}>Download</a>
      </div>
      <p className="install-hook-status">
        <span role="status" aria-live="polite">{status||desktopFirstOpen}</span>
        <button ref={copyRef} type="button" className="install-hook-alt" onClick={()=>void copy(runeInstall)} aria-label="Copy the Rune install command">{copied?"Copied ✓":"Terminal install"}</button>
      </p>
    </>:<>
      <div className="install-hook-line" data-copied={copied}>
        <span className="install-hook-prompt" aria-hidden="true">$</span>
        <code ref={code} onClick={()=>void copy(command)}>{command}</code>
        <button ref={copyRef} type="button" className="install-hook-copy" onClick={()=>void copy(command)} aria-label={`Copy the ${target.label} install command`}>{copied?"Copied ✓":"Copy"}</button>
      </div>
      <p className="install-hook-status" role="status" aria-live="polite">{status}</p>
    </>}
    {!mobile&&canShare()&&<button type="button" className="install-hook-share" onClick={()=>void share()}>Share ↗</button>}
  </section>;
}

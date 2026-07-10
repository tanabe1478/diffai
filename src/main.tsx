import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Proposal, ServerEvent } from "./types";
import "./style.css";

function escapeLine(line: string) { return line || " "; }
function Diff({ proposal }: { proposal: Proposal }) {
  const before = proposal.before.split("\n"), after = proposal.after.split("\n");
  const rows = useMemo(() => {
    const result: { kind: string; left?: string; right?: string }[] = [];
    const max = Math.max(before.length, after.length);
    for (let i=0;i<max;i++) {
      if (before[i] === after[i]) result.push({ kind:"same", left:before[i], right:after[i] });
      else result.push({ kind:"changed", left:before[i], right:after[i] });
    } return result;
  }, [proposal]);
  return <div className="diff">{rows.map((r,i)=><div className={`diff-row ${r.kind}`} key={i}>
    <span className="num">{i+1}</span><pre className={r.kind==="changed"?"removed":""}>{escapeLine(r.left??"")}</pre>
    <span className="num">{i+1}</span><pre className={r.kind==="changed"?"added":""}>{escapeLine(r.right??"")}</pre>
  </div>)}</div>;
}
function App() {
  const [proposals,setProposals]=useState<Proposal[]>([]), [selected,setSelected]=useState<string>();
  const [messages,setMessages]=useState<{role:string;text:string}[]>([]), [input,setInput]=useState("");
  const [cwd,setCwd]=useState("接続中…"), [status,setStatus]=useState("connecting"), [error,setError]=useState("");
  const ws=useRef<WebSocket | undefined>(undefined); const assistant=useRef("");
  useEffect(()=>{ const socket=new WebSocket(`${location.protocol==="https:"?"wss":"ws"}://${location.host}/ws`); ws.current=socket;
    socket.onmessage=e=>{const ev=JSON.parse(e.data) as ServerEvent;
      if(ev.type==="ready"){setCwd(ev.cwd);setProposals(ev.proposals);setSelected(ev.proposals[0]?.id)}
      else if(ev.type==="proposal"){setProposals(p=>[...p,ev.proposal]);setSelected(ev.proposal.id)}
      else if(ev.type==="proposal_updated")setProposals(p=>p.map(x=>x.id===ev.proposal.id?ev.proposal:x));
      else if(ev.type==="status"){setStatus(ev.detail?`${ev.status}: ${ev.detail}`:ev.status);if(ev.status==="idle"&&assistant.current){setMessages(m=>[...m,{role:"assistant",text:assistant.current}]);assistant.current=""}}
      else if(ev.type==="text_delta"){assistant.current+=ev.delta;setStatus("streaming")}
      else if(ev.type==="error")setError(ev.message);
    }; return()=>socket.close(); },[]);
  const current=proposals.find(p=>p.id===selected);
  const sendPrompt=()=>{if(!input.trim())return;ws.current?.send(JSON.stringify({type:"prompt",message:input}));setMessages(m=>[...m,{role:"user",text:input}]);setInput("")};
  const review=(decision:string)=>{if(!current)return;const feedback=(document.querySelector("#feedback") as HTMLTextAreaElement).value;ws.current?.send(JSON.stringify({type:"review",id:current.id,decision,feedback}))};
  return <main><header><b>diff<span>ai</span></b><div className="workspace">{cwd}</div><div className={`status ${status}`}>● {status}</div></header>
    {error&&<div className="error" onClick={()=>setError("")}>{error} ×</div>}
    <section className="layout"><aside><h3>変更提案 <small>{proposals.length}</small></h3>{proposals.map(p=><button className={selected===p.id?"active":""} onClick={()=>setSelected(p.id)} key={p.id}><i className={p.status}/><span>{p.path}<small>{p.summary}</small></span></button>)}{!proposals.length&&<p className="empty">Piに変更を依頼してください</p>}</aside>
    <article>{current?<><div className="title"><div><h2>{current.path}</h2><p>{current.summary}</p></div><em className={current.status}>{current.status}</em></div><Diff proposal={current}/><div className="review"><textarea id="feedback" placeholder="修正してほしい点や判断理由（任意）"/><button className="reject" disabled={current.status!=="pending"} onClick={()=>review("reject")}>却下・再修正</button><button className="approve" disabled={current.status!=="pending"} onClick={()=>review("approve")}>承認して適用</button></div></>:<div className="welcome"><h1>Review AI changes,<br/>before they happen.</h1><p>右のチャットからPiに作業を依頼してください。</p></div>}</article>
    <aside className="chat"><h3>Pi</h3><div className="messages">{messages.map((m,i)=><div className={m.role} key={i}>{m.text}</div>)}{status==="streaming"&&<div className="assistant live">{assistant.current}</div>}</div><div className="composer"><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendPrompt()}}} placeholder="変更内容を依頼…"/><button onClick={sendPrompt}>↑</button></div></aside></section></main>;
}
createRoot(document.getElementById("root")!).render(<App/>);

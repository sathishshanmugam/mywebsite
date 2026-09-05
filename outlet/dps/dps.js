let staffRows = [];

function money(n){ return "₹" + Math.round(Number(n)||0).toLocaleString("en-IN"); }
function isoToday(){ return new Date().toISOString().slice(0,10); }

function setDateInfo(){
  const value = $("date").value;
  if(!value) return;
  const d = new Date(value + "T00:00:00");
  $("dayName").value = d.toLocaleDateString("en-IN",{weekday:"long"});
  calculate();
}

function isWeekend(){
  const d = new Date($("date").value + "T00:00:00");
  return [0,6].includes(d.getDay());
}

function renderStaff(){
  $("staffList").innerHTML = staffRows.map((row,i)=>`
    <div class="staff-row">
      <div><div class="staff-label">Staff ${i+1}</div><div class="muted">No name required</div></div>
      <div><label>Working Hours</label><input class="hours" data-index="${i}" type="number" min="0" max="24" step="0.25" value="${row.hours}"></div>
      <button class="remove" data-remove="${i}" ${staffRows.length===1?"disabled":""}>Remove</button>
    </div>`).join("");

  document.querySelectorAll(".hours").forEach(el => el.addEventListener("input",()=>{
    staffRows[Number(el.dataset.index)].hours = Number(el.value)||0;
    calculate();
  }));
  document.querySelectorAll("[data-remove]").forEach(el=>el.addEventListener("click",()=>{
    staffRows.splice(Number(el.dataset.remove),1); renderStaff(); calculate();
  }));
}

function calculate(){
  const sales = Number($("sales").value)||0;
  const target = isWeekend() ? Number($("weekendTarget").value)||0 : Number($("weekdayTarget").value)||0;
  const excess = Math.max(0,sales-target);
  const rate = (Number($("rate").value)||0)/100;
  const pool = excess*rate;
  const hours = staffRows.reduce((s,x)=>s+(Number(x.hours)||0),0);
  const perHour = hours>0 ? pool/hours : 0;

  $("target").textContent=money(target);
  $("excess").textContent=money(excess);
  $("pool").textContent=money(pool);
  $("totalHours").textContent=hours.toFixed(2).replace(/\.00$/,"");
  $("perHour").textContent=money(perHour);

  const achieved = sales >= target && target > 0;
  $("targetStatus").className = "status " + (achieved ? "good" : "bad");
  $("targetStatus").textContent = target ? (achieved ? "✓ Target achieved — this day can be submitted." : "Target not achieved — this day will not be saved.") : "";
  return {sales,target,excess,rate,pool,hours,perHour,achieved};
}

async function submitDay(){
  const c=calculate();
  if(!c.achieved){ alert("This day has not achieved the target, so it cannot be submitted."); return; }
  if(c.hours<=0){ alert("Please enter working hours for at least one staff member."); return; }

  const date=$("date").value;
  if(!date){ alert("Please select a date."); return; }

  $("submitBtn").disabled=true;
  $("saveStatus").textContent="Saving...";

  const payload={
    outletId: staffAccess.outletId,
    outletName: staffAccess.outletName || staffAccess.outletId,
    date,
    dayName: $("dayName").value,
    sales:c.sales,
    target:c.target,
    excessSales:c.excess,
    incentiveRate:c.rate,
    incentivePool:c.pool,
    totalHours:c.hours,
    incentivePerHour:c.perHour,
    staff:staffRows.map((x,i)=>({staffNumber:i+1,hours:Number(x.hours)||0,incentive:(Number(x.hours)||0)*c.perHour})),
    submittedAt:firebase.firestore.FieldValue.serverTimestamp(),
    submittedBy:currentUser.uid
  };

  try{
    await db.collection("dps_records").doc(`${staffAccess.outletId}_${date}`).set(payload,{merge:true});
    $("saveStatus").textContent="Saved successfully.";
    await loadRecords();
  }catch(e){
    console.error(e);
    $("saveStatus").textContent="";
    alert("Could not save this record. Please check your Firestore rules.");
  }finally{ $("submitBtn").disabled=false; }
}

async function loadRecords(){
  const snap=await db.collection("dps_records").where("outletId","==",staffAccess.outletId).orderBy("date","desc").limit(100).get();
  $("records").innerHTML=snap.empty ? '<div class="muted">No achieved days recorded yet.</div>' :
    snap.docs.map(doc=>{
      const r=doc.data();
      const staff=(r.staff||[]).map(x=>`Staff ${x.staffNumber}: ${Number(x.hours||0)} hrs → ${money(x.incentive||0)}`).join(" • ");
      return `<div class="record"><div class="record-head"><div class="record-title">${r.date} · ${r.dayName||""}</div><strong>${money(r.incentivePool||0)}</strong></div><div class="record-meta">Sales ${money(r.sales)} · Target ${money(r.target)} · Excess ${money(r.excessSales)}</div><div class="staff-split">${staff}</div></div>`;
    }).join("");
}

function whatsappSummary(){
  const c=calculate();
  if(!c.achieved){ alert("WhatsApp summary is available only for an achieved day."); return; }
  const lines=[
    `CRUNCHERY'S - DPS`,
    `Outlet: ${staffAccess.outletName||staffAccess.outletId}`,
    `Date: ${$("date").value} (${$("dayName").value})`,
    `Sales: ${money(c.sales)}`,
    `Target: ${money(c.target)}`,
    `Excess: ${money(c.excess)}`,
    `Incentive Pool: ${money(c.pool)}`,
    `Total Hours: ${c.hours}`,
    `Incentive/Hour: ${money(c.perHour)}`,
    ``,
    ...staffRows.map((x,i)=>`Staff ${i+1}: ${Number(x.hours)||0} hrs → ${money((Number(x.hours)||0)*c.perHour)}`)
  ];
  window.open("https://wa.me/?text="+encodeURIComponent(lines.join("\n")),"_blank");
}

$("date").value=isoToday();
staffRows=[{hours:0}];
$("date").addEventListener("change",setDateInfo);
["sales","weekdayTarget","weekendTarget","rate"].forEach(id=>$(id).addEventListener("input",calculate));
$("addStaffBtn").addEventListener("click",()=>{staffRows.push({hours:0});renderStaff();calculate();});
$("submitBtn").addEventListener("click",submitDay);
$("whatsappBtn").addEventListener("click",whatsappSummary);
renderStaff(); setDateInfo();

requireStaffAccess(async access=>{
  $("outletName").textContent=access.outletName||access.outletId;
  try{ await loadRecords(); }catch(e){ console.error(e); $("records").innerHTML='<div class="muted">Could not load records. Check the Firestore index/rules.</div>'; }
});

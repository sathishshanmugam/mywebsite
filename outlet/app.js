let currentUser = null;
let staffAccess = null;
let availability = new Map();
let confirmationResult = null;
let recaptchaVerifier = null;
let saveTimer = null;

const $ = id => document.getElementById(id);

function slugifyProductName(name){
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^-+|-+$/g, "");
}

function show(id, visible){
  $(id).classList.toggle("hidden", !visible);
}

function escapeHtml(value){
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function setStatus(message){
  $("saveStatus").textContent = message || "";
}

function normalizePhone(value){
  let phone = String(value || "").trim().replace(/[\s()-]/g,"");
  if(phone.startsWith("0")) phone = "+91" + phone.slice(1);
  if(/^\d{10}$/.test(phone)) phone = "+91" + phone;
  return phone;
}

function renderCategories(){
  const categories = [...new Set(MENU.map(x => x.category).filter(Boolean))].sort();
  $("categoryFilter").innerHTML =
    '<option value="">All categories</option>' +
    categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
}

function filteredMenu(){
  const q = $("searchInput").value.trim().toLowerCase();
  const cat = $("categoryFilter").value;

  return MENU.filter(item => {
    const matchesText = !q || item.name.toLowerCase().includes(q);
    const matchesCategory = !cat || item.category === cat;
    return matchesText && matchesCategory;
  });
}

function renderMenu(){
  const list = $("menuList");
  const items = filteredMenu();

  if(!items.length){
    list.innerHTML = '<div class="empty">No menu items found.</div>';
    return;
  }

  list.innerHTML = items.map(item => {
    const productId = item.productId || slugifyProductName(item.name);
    const on = availability.get(productId) === true;

    return `
      <div class="menu-row">
        <div class="item-main">
          <div class="item-name">${escapeHtml(item.name)}</div>
          <div class="item-meta">${escapeHtml(item.category || "Menu")}${item.price != null ? " • ₹" + Number(item.price).toLocaleString("en-IN") : ""}</div>
        </div>
        <label class="switch" title="${on ? "Available" : "Off / Sold out"}">
          <input type="checkbox" data-product-id="${escapeHtml(productId)}" ${on ? "checked" : ""}>
          <span class="slider"></span>
        </label>
      </div>`;
  }).join("");

  list.querySelectorAll("input[data-product-id]").forEach(input => {
    input.addEventListener("change", () => {
      setAvailability(input.dataset.productId, input.checked);
    });
  });
}

function updateSummary(){
  const total = MENU.length;
  let available = 0;

  MENU.forEach(item => {
    const id = item.productId || slugifyProductName(item.name);
    if(availability.get(id) === true) available++;
  });

  $("totalItems").textContent = total;
  $("availableItems").textContent = available;
  $("offItems").textContent = total - available;
}

async function loadStaffAccess(user){

  if(!user?.uid){
    throw new Error("USER_NOT_AVAILABLE");
  }

  // Firebase Authentication UID identifies the outlet company phone.
  // Firestore staff/{UID} tells us which outlet this phone belongs to.
  const doc = await db
    .collection("staff")
    .doc(user.uid)
    .get();

  if(!doc.exists){
    throw new Error("OUTLET_NOT_CONFIGURED");
  }

  const data = doc.data();

  if(data.active === false){
    throw new Error("ACCESS_DISABLED");
  }

  if(!data.outletId){
    throw new Error("OUTLET_NOT_CONFIGURED");
  }

  return data;
}

async function setAvailability(productId, value){
  if(!staffAccess?.outletId || !currentUser) return;

  const previous = availability.get(productId) === true;
  availability.set(productId, value);
  renderMenu();
  updateSummary();
  setStatus("Saving...");

  try{
    await db.collection("outlet_products")
      .doc(`${staffAccess.outletId}_${productId}`)
      .set({
        outletId: staffAccess.outletId,
        productId,
        available: value,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, {merge:true});

    setStatus(value ? "Item turned ON." : "Item turned OFF.");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => setStatus(""), 1800);
  }catch(error){
    console.error(error);
    availability.set(productId, previous);
    renderMenu();
    updateSummary();
    setStatus("");
    alert("Could not save this change. Please check your Firestore permissions.");
  }
}

async function setAll(value){
  if(!staffAccess?.outletId || !currentUser) return;

  setStatus("Saving menu...");
  const batch = db.batch();

  MENU.forEach(item => {
    const productId = item.productId || slugifyProductName(item.name);
    availability.set(productId, value);

    const ref = db.collection("outlet_products")
      .doc(`${staffAccess.outletId}_${productId}`);

    batch.set(ref, {
      outletId: staffAccess.outletId,
      productId,
      available: value,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, {merge:true});
  });

  try{
    await batch.commit();
    renderMenu();
    updateSummary();
    setStatus(value ? "All menu items are ON." : "All menu items are OFF.");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => setStatus(""), 2000);
  }catch(error){
    console.error(error);
    await loadAvailability();
    setStatus("");
    alert("Could not save the menu changes. Please check Firestore permissions.");
  }
}

function friendlyAuthError(error){
  const code = error?.code || "";

  if(code === "auth/invalid-phone-number") return "Please enter a valid Indian mobile number.";
  if(code === "auth/too-many-requests") return "Too many attempts. Please try again later.";
  if(code === "auth/quota-exceeded") return "SMS quota has been reached. Please try again later.";
  if(code === "auth/code-expired") return "This OTP has expired. Please request a new OTP.";
  if(code === "auth/invalid-verification-code") return "Incorrect OTP. Please try again.";
  if(code === "auth/missing-verification-code") return "Please enter the OTP.";
  if(code === "auth/captcha-check-failed") return "reCAPTCHA verification failed. Please try again.";

  return error?.message || "Authentication failed.";
}

function setupRecaptcha(){
  if(recaptchaVerifier) return;

  recaptchaVerifier = new firebase.auth.RecaptchaVerifier("recaptcha-container", {
    size: "normal",
    callback: () => {
      $("sendOtpBtn").disabled = false;
    },
    "expired-callback": () => {
      $("sendOtpBtn").disabled = false;
    }
  });

  recaptchaVerifier.render().catch(error => {
    console.error(error);
    $("loginError").textContent = "Could not load reCAPTCHA. Please refresh the page.";
  });
}

async function sendOtp(){
  $("loginError").textContent = "";

  const phone = normalizePhone($("phone").value);

  if(!/^\+91\d{10}$/.test(phone)){
    $("loginError").textContent = "Enter a valid 10-digit Indian mobile number.";
    return;
  }

  $("sendOtpBtn").disabled = true;
  setStatus("");

  try{
    setupRecaptcha();

    confirmationResult = await auth.signInWithPhoneNumber(phone, recaptchaVerifier);

    show("phoneStep", false);
    show("otpStep", true);
    $("otp").focus();
    $("loginError").textContent = "";
  }catch(error){
    console.error(error);
    $("loginError").textContent = friendlyAuthError(error);

    try{
      if(recaptchaVerifier){
        recaptchaVerifier.clear();
        recaptchaVerifier = null;
      }
      setupRecaptcha();
    }catch(e){
      console.error(e);
    }

    $("sendOtpBtn").disabled = false;
  }
}

async function verifyOtp(){
  $("loginError").textContent = "";

  if(!confirmationResult){
    $("loginError").textContent = "Please request a new OTP.";
    return;
  }

  const otp = $("otp").value.trim();

  if(!/^\d{6}$/.test(otp)){
    $("loginError").textContent = "Enter the 6-digit OTP.";
    return;
  }

  $("verifyOtpBtn").disabled = true;

  try{
    await confirmationResult.confirm(otp);
  }catch(error){
    console.error(error);
    $("loginError").textContent = friendlyAuthError(error);
    $("verifyOtpBtn").disabled = false;
  }
}

function resetPhoneLogin(){
  confirmationResult = null;
  $("otp").value = "";
  $("loginError").textContent = "";
  show("otpStep", false);
  show("phoneStep", true);
  $("sendOtpBtn").disabled = false;

  try{
    if(recaptchaVerifier){
      recaptchaVerifier.clear();
      recaptchaVerifier = null;
    }
    setupRecaptcha();
  }catch(error){
    console.error(error);
  }
}

$("sendOtpBtn").addEventListener("click", sendOtp);
$("verifyOtpBtn").addEventListener("click", verifyOtp);
$("changeNumberBtn").addEventListener("click", resetPhoneLogin);

$("logoutBtn").addEventListener("click", () => auth.signOut());

$("searchInput").addEventListener("input", renderMenu);
$("categoryFilter").addEventListener("change", renderMenu);
$("allOnBtn").addEventListener("click", () => setAll(true));
$("allOffBtn").addEventListener("click", () => setAll(false));

auth.onAuthStateChanged(async user => {
  currentUser = user;

  if(!user){
    staffAccess = null;
    show("loginView", true);
    show("dashboardView", false);
    return;
  }

  try{
    staffAccess = await loadStaffAccess(user);

    show("loginView", false);
    show("dashboardView", true);

    $("outletName").textContent = staffAccess.outletName || staffAccess.outletId;
    $("staffName").textContent = "Outlet Staff";

    renderCategories();
    await loadAvailability();
  }catch(error){
    console.error(error);

    let message = "This phone number is not configured for outlet staff access.";
    if(error.message === "ACCESS_DISABLED") message = "Staff access for this outlet is disabled.";
    if(error.message === "OUTLET_NOT_CONFIGURED") message = "This phone number has not been assigned to an outlet.";

    await auth.signOut();
    $("loginError").textContent = message;
  }
});

// Prepare reCAPTCHA when the page loads.
setupRecaptcha();

let currentUser = null;
let staffAccess = null;
let confirmationResult = null;
let recaptchaVerifier = null;

const $ = id => document.getElementById(id);
const show = (id, visible) => $(id)?.classList.toggle("hidden", !visible);

function normalizePhone(value){
  let phone = String(value || "").trim().replace(/[\s()-]/g,"");
  if(phone.startsWith("0")) phone = "+91" + phone.slice(1);
  if(/^\d{10}$/.test(phone)) phone = "+91" + phone;
  return phone;
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

/*
  IMPORTANT:
  Your current Firestore rules use:
    staff_access/{phoneNumber}
  and the phone number from Firebase Authentication.
  Therefore the portal uses that same source instead of staff/{UID}.
*/
async function loadStaffAccess(user){
  if(!user?.uid || !user.phoneNumber) throw new Error("USER_NOT_AVAILABLE");

  const phone = user.phoneNumber;
  const doc = await db.collection("staff_access").doc(phone).get();

  if(!doc.exists) throw new Error("OUTLET_NOT_CONFIGURED");

  const data = doc.data();
  if(data.active === false) throw new Error("ACCESS_DISABLED");
  if(!data.outletId) throw new Error("OUTLET_NOT_CONFIGURED");

  return { ...data, phoneNumber: phone };
}

function setupRecaptcha(containerId="recaptcha-container", sendButtonId="sendOtpBtn", errorId="loginError"){
  if(recaptchaVerifier) return;

  recaptchaVerifier = new firebase.auth.RecaptchaVerifier(containerId, {
    size: "normal",
    callback: () => { if($(sendButtonId)) $(sendButtonId).disabled = false; },
    "expired-callback": () => { if($(sendButtonId)) $(sendButtonId).disabled = false; }
  });

  recaptchaVerifier.render().catch(error => {
    console.error(error);
    if($(errorId)) $(errorId).textContent = "Could not load reCAPTCHA. Please refresh the page.";
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
  try{
    setupRecaptcha();
    confirmationResult = await auth.signInWithPhoneNumber(phone, recaptchaVerifier);
    show("phoneStep", false);
    show("otpStep", true);
    $("otp").focus();
  }catch(error){
    console.error(error);
    $("loginError").textContent = friendlyAuthError(error);
    try{
      if(recaptchaVerifier){ recaptchaVerifier.clear(); recaptchaVerifier = null; }
      setupRecaptcha();
    }catch(e){ console.error(e); }
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
    if(recaptchaVerifier){ recaptchaVerifier.clear(); recaptchaVerifier = null; }
    setupRecaptcha();
  }catch(error){ console.error(error); }
}

function requireStaffAccess(callback){
  auth.onAuthStateChanged(async user => {
    currentUser = user;

    if(!user){
      show("loginView", true);
      show("appView", false);
      return;
    }

    try{
      staffAccess = await loadStaffAccess(user);
      show("loginView", false);
      show("appView", true);
      callback?.(staffAccess);
    }catch(error){
      console.error("STAFF ACCESS ERROR:", error);
      await auth.signOut();
      $("loginError").textContent =
        `${error.code || "ERROR"}: ${error.message || error}`;
    }
  });
}

$("sendOtpBtn")?.addEventListener("click", sendOtp);
$("verifyOtpBtn")?.addEventListener("click", verifyOtp);
$("changeNumberBtn")?.addEventListener("click", resetPhoneLogin);
$("logoutBtn")?.addEventListener("click", () => auth.signOut());

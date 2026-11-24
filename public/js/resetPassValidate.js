// Client-side validation for reset-password form (scoped specifically to .auth-form)
const resetForm = document.querySelector(".auth-form");
const enteredPass = document.querySelector("#password");
const errorPass = document.querySelector(".error-password");

if (resetForm && enteredPass && errorPass) {
    resetForm.addEventListener("submit", function (e) {
        const passVal = enteredPass.value;
        errorPass.innerText = "";

        if (passVal.length < 8) {
            e.preventDefault();
            errorPass.innerText = "Password must contain at least 8 characters.";
            enteredPass.focus();
            return;
        }
        if (passVal.length > 72) {
            e.preventDefault();
            errorPass.innerText = "Password cannot exceed 72 characters.";
            enteredPass.focus();
            return;
        }
        if (!/[a-z]/.test(passVal)) {
            e.preventDefault();
            errorPass.innerText = "Password must contain at least one lowercase letter.";
            enteredPass.focus();
            return;
        }
        if (!/[A-Z]/.test(passVal)) {
            e.preventDefault();
            errorPass.innerText = "Password must contain at least one uppercase letter.";
            enteredPass.focus();
            return;
        }
        if (!/[0-9]/.test(passVal)) {
            e.preventDefault();
            errorPass.innerText = "Password must contain at least one number.";
            enteredPass.focus();
            return;
        }
        if (!/[@$!%*?&#]/.test(passVal)) {
            e.preventDefault();
            errorPass.innerText = "Password must contain at least one special character (@$!%*?&#).";
            enteredPass.focus();
            return;
        }
    });
}

// Client-side validation for signup form (scoped specifically to .auth-form so navbar search is untouched)
const form = document.querySelector(".auth-form");
const enteredName = document.querySelector("#name");
const enteredEmail = document.querySelector("#email");
const enteredPass = document.querySelector("#password");

const errorName = document.querySelector(".error-name");
const errorEmail = document.querySelector(".error-email");
const errorPass = document.querySelector(".error-password");

if (form && enteredName && enteredEmail && enteredPass) {
    form.addEventListener("submit", function (e) {
        const nameVal = enteredName.value.trim();
        errorName.innerText = "";

        if (nameVal.length < 2 || nameVal.length > 100) {
            e.preventDefault();
            errorName.innerText = "Name must be between 2 and 100 characters.";
            enteredName.focus();
            return;
        }
        if (/[<>]/.test(nameVal)) {
            e.preventDefault();
            errorName.innerText = "Name cannot contain < or > characters.";
            enteredName.focus();
            return;
        }

        const emailVal = enteredEmail.value.trim();
        errorEmail.innerText = "";

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailPattern.test(emailVal) || emailVal.length > 254) {
            e.preventDefault();
            errorEmail.innerText = "Invalid email. Please enter a valid email address.";
            enteredEmail.focus();
            return;
        }

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

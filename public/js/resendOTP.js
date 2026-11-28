// 1. Resend OTP 60-second countdown
const resendButton = document.getElementById("resend-otp-button");
const countdownMessage = document.getElementById("resend-countdown-message");
const countdownText = document.getElementById("resend-countdown");

if (resendButton && countdownMessage && countdownText) {
    let secondsLeft = 60;

    const countdownTimer = setInterval(() => {
        secondsLeft--;
        countdownText.textContent = secondsLeft;

        if (secondsLeft <= 0) {
            clearInterval(countdownTimer);
            countdownMessage.hidden = true;
            resendButton.hidden = false;
        }
    }, 1000);
}

// 2. Apple-style 6-digit OTP boxes (typing, backspace, arrow keys & full paste)
const otpForm = document.getElementById("otpVerifyForm");
const hiddenOtpInput = document.getElementById("otp");
const inlineError = document.getElementById("otpInlineError");
const digitBoxes = Array.from(document.querySelectorAll(".otp-digit-box"));

if (otpForm && hiddenOtpInput && digitBoxes.length === 6) {
    const syncOtpValue = () => {
        const code = digitBoxes.map((box) => box.value).join("");
        hiddenOtpInput.value = code;
        digitBoxes.forEach((box) => {
            box.classList.toggle("is-filled", box.value !== "");
        });
        if (inlineError && code.length === 6) {
            inlineError.textContent = "";
        }
    };

    const fillFromText = (text, startIndex = 0) => {
        const digits = text.replace(/\D/g, "").slice(0, 6);
        if (!digits) return;

        for (let i = 0; i < digits.length && startIndex + i < 6; i++) {
            digitBoxes[startIndex + i].value = digits[i];
        }
        syncOtpValue();

        const nextFocus = Math.min(startIndex + digits.length, 5);
        digitBoxes[nextFocus].focus();
    };

    digitBoxes.forEach((box, index) => {
        box.addEventListener("input", (event) => {
            const cleaned = event.target.value.replace(/\D/g, "");

            // Handle multi-digit paste or mobile SMS autofill
            if (cleaned.length > 1) {
                fillFromText(cleaned, 0);
                return;
            }

            box.value = cleaned;
            syncOtpValue();

            if (cleaned && index < 5) {
                digitBoxes[index + 1].focus();
            }
        });

        box.addEventListener("keydown", (event) => {
            if (event.key === "Backspace" && !box.value && index > 0) {
                digitBoxes[index - 1].value = "";
                digitBoxes[index - 1].focus();
                syncOtpValue();
            } else if (event.key === "ArrowLeft" && index > 0) {
                digitBoxes[index - 1].focus();
            } else if (event.key === "ArrowRight" && index < 5) {
                digitBoxes[index + 1].focus();
            }
        });

        box.addEventListener("paste", (event) => {
            event.preventDefault();
            const pasted = (event.clipboardData || window.clipboardData).getData("text");
            fillFromText(pasted, 0);
        });

        box.addEventListener("focus", () => {
            box.select();
        });
    });

    otpForm.addEventListener("submit", (event) => {
        syncOtpValue();
        if (!/^[0-9]{6}$/.test(hiddenOtpInput.value)) {
            event.preventDefault();
            if (inlineError) {
                inlineError.textContent = "Please enter all 6 digits of your verification code.";
            }
            const firstEmpty = digitBoxes.find((box) => !box.value) || digitBoxes[0];
            firstEmpty.focus();
        }
    });
}
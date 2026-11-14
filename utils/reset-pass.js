let form = document.querySelector('form');

let enteredPass = document.querySelector('#password');
let errorPass = document.querySelector('.error-password');

form.addEventListener( "submit" , function( e ) {

    let passVal = enteredPass.value// Never trim password of user as it is compliant with OWASP Security Standard

    errorPass.innerText = "";

    if( passVal.length < 8 ){
        e.preventDefault();
        errorPass.innerText = "Password must contain atleast 8 characters";
        enteredPass.focus();
        return;
    }

     // .test is a regex method which returns true or false it scans each word sent in its method and matches it with regex pattern

     const hasLower = /[a-z]/.test(passVal ); // checks whether atleast one lower case present or not
     const hasUpper  = /[A-Z]/.test(passVal );// checks whether atleast one  upper case present or not 
     const hasNumber = /[0-9]/.test(passVal);// checks whether atleast one number is present or not
     const hasSpecial = /[@$!%*?&#]/.test(passVal);// checks whether atleast one special case present or not

     if( !hasLower ){
        e.preventDefault();
        errorPass.innerText = "Password must contain atleast one small case character";
        enteredPass.focus();
        return;
     };

     if( !hasUpper ){
        e.preventDefault();
        errorPass.innerText = "Password must contain atleast one upper case character";
        enteredPass.focus();
        return;
     };

     if( !hasNumber ){
        e.preventDefault();
        errorPass.innerText = "Password must contain atleast one number";
        enteredPass.focus();
        return;
     };

     if( !hasSpecial ){
        e.preventDefault();
        errorPass.innerText = "Password must contain atleast one special character";
        enteredPass.focus();
        return;
     };
});

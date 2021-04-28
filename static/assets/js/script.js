$(document).ready(function() {
    var optionValue = undefined;
    $('input[type="radio"]').click(function() {
        // console.log(optionValue);
        if (optionValue) {
            $("#show-"+optionValue).hide();
        }
        optionValue = $(this).val();
        $("textInputDiv").hide();
        $("#show-"+optionValue).show();
    });
    $('input[type="radio"]#new-antipattern').click(function() {
        $('input[type="text"]#inputNewProperty')[0].setAttribute("required", true);
        $('input[type="text"]#inputNewEntity')[0].setAttribute("required", true);
    });
});

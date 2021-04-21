$(document).ready(function() {
    var optionValue = undefined;
    $('input[type="radio"]').click(function() {
        console.log(optionValue);
        if (optionValue) {
            $("#show-"+optionValue).hide();
        }
        optionValue = $(this).val();
        $("textInputDiv").hide();
        $("#show-"+optionValue).show();
    });
});

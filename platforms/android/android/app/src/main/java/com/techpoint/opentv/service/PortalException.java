package com.techpoint.opentv.service;

/* An error with the portal's returnCode, which the service reports as
   errorCode (index.js fail()). */
final class PortalException extends Exception {
    final String portalCode;

    PortalException(String message) {
        this(message, null);
    }

    PortalException(String message, String portalCode) {
        super(message);
        this.portalCode = portalCode;
    }
}

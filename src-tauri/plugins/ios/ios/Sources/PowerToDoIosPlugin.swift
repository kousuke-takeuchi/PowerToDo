import AuthenticationServices
import Network
import SwiftRs
import Tauri
import UIKit
import WebKit

private struct PathPayload: Encodable {
  let status: String
  let interfaces: [String]
}

private struct AuthArgs: Decodable {
  let url: String
  let callbackScheme: String
}

private struct AuthReply: Encodable {
  let url: String
}

class PowerToDoIosPlugin: Plugin, ASWebAuthenticationPresentationContextProviding {
  private var monitor: NWPathMonitor?
  private let monitorQueue = DispatchQueue(label: "app.powertodo.path-monitor")
  private var session: ASWebAuthenticationSession?

  /// Starts the path monitor (once). Called after the Rust side registered its `pathChanged`
  /// listener, so the first report (the current state) reaches it.
  @objc func startPathMonitor(_ invoke: Invoke) {
    if monitor == nil {
      let m = NWPathMonitor()
      m.pathUpdateHandler = { [weak self] path in
        let status: String
        switch path.status {
        case .satisfied: status = "satisfied"
        case .unsatisfied: status = "unsatisfied"
        case .requiresConnection: status = "requiresConnection"
        @unknown default: status = "unsatisfied"
        }
        var interfaces: [String] = []
        if path.usesInterfaceType(.wifi) { interfaces.append("wifi") }
        if path.usesInterfaceType(.cellular) { interfaces.append("cellular") }
        if path.usesInterfaceType(.wiredEthernet) { interfaces.append("wiredEthernet") }
        if path.usesInterfaceType(.other) { interfaces.append("other") }
        try? self?.trigger("pathChanged", data: PathPayload(status: status, interfaces: interfaces))
      }
      m.start(queue: monitorQueue)
      monitor = m
    }
    invoke.resolve()
  }

  /// Shows the system login sheet for `url` and answers with the URL that starts with
  /// `callbackScheme`. The sheet closed by the user rejects with code `cancelled`.
  @objc func authenticate(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AuthArgs.self)
    guard let url = URL(string: args.url) else {
      invoke.reject("invalid url")
      return
    }
    DispatchQueue.main.async {
      let session = ASWebAuthenticationSession(
        url: url, callbackURLScheme: args.callbackScheme
      ) { [weak self] callbackURL, error in
        self?.session = nil
        if let callbackURL = callbackURL {
          invoke.resolve(AuthReply(url: callbackURL.absoluteString))
          return
        }
        let ns = error as NSError?
        if ns?.domain == ASWebAuthenticationSessionErrorDomain,
          ns?.code == ASWebAuthenticationSessionError.canceledLogin.rawValue
        {
          invoke.reject("cancelled", code: "cancelled")
        } else {
          invoke.reject(error?.localizedDescription ?? "login failed")
        }
      }
      session.presentationContextProvider = self
      session.prefersEphemeralWebBrowserSession = false
      self.session = session
      if !session.start() {
        self.session = nil
        invoke.reject("could not show the login sheet")
      }
    }
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    return manager.viewController?.view.window ?? ASPresentationAnchor()
  }
}

@_cdecl("init_plugin_powertodo_ios")
public func initPlugin() -> Plugin {
  return PowerToDoIosPlugin()
}

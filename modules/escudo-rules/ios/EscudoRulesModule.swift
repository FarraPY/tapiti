import ExpoModulesCore
import WebKit

/**
 * Bloqueo nativo con `WKContentRuleList`.
 *
 * Las reglas se compilan una sola vez y quedan guardadas en el sistema. A partir
 * de ahí las aplica WebKit en la capa de red, antes de que el pedido salga del
 * teléfono: no viajan dentro de cada página, alcanzan a los marcos internos y no
 * cuestan nada por página. Es lo que reemplaza al megabyte de lista inyectada.
 */
public final class EscudoRulesModule: Module {
  /// Listas ya compiladas en esta sesión, para no volver a buscarlas en disco.
  private var loaded: [String: WKContentRuleList] = [:]

  public func definition() -> ModuleDefinition {
    Name("EscudoRules")

    /// Compila una lista y la deja guardada. Es la operación cara: minutos de CPU
    /// la primera vez, instantánea después porque el sistema la conserva.
    AsyncFunction("compile") { (identifier: String, json: String, promise: Promise) in
      guard let store = WKContentRuleListStore.default() else {
        promise.reject("sin_almacen", "El sistema no expuso el almacén de reglas")
        return
      }
      store.compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: json) {
        list, error in
        if let error {
          // El compilador de WebKit rechaza la lista entera si una sola regla está
          // mal formada, y el mensaje dice cuál: vale la pena pasarlo tal cual.
          promise.reject("compilar", error.localizedDescription)
          return
        }
        guard let list else {
          promise.reject("compilar", "No devolvió lista ni error")
          return
        }
        self.loaded[identifier] = list
        promise.resolve(true)
      }
    }

    /// Trae del disco una lista compilada antes. Devuelve false si no está.
    AsyncFunction("load") { (identifier: String, promise: Promise) in
      guard let store = WKContentRuleListStore.default() else {
        promise.resolve(false)
        return
      }
      store.lookUpContentRuleList(forIdentifier: identifier) { list, _ in
        if let list {
          self.loaded[identifier] = list
          promise.resolve(true)
        } else {
          promise.resolve(false)
        }
      }
    }

    /// Identificadores que ya están compilados y guardados en el sistema.
    AsyncFunction("stored") { (promise: Promise) in
      guard let store = WKContentRuleListStore.default() else {
        promise.resolve([String]())
        return
      }
      store.getAvailableContentRuleListIdentifiers { ids in
        promise.resolve(ids ?? [])
      }
    }

    /// Borra una lista guardada. Se usa al actualizar: primero se compila la nueva,
    /// después se tira la vieja, nunca al revés.
    AsyncFunction("remove") { (identifier: String, promise: Promise) in
      guard let store = WKContentRuleListStore.default() else {
        promise.resolve(false)
        return
      }
      store.removeContentRuleList(forIdentifier: identifier) { _ in
        self.loaded.removeValue(forKey: identifier)
        promise.resolve(true)
      }
    }

    /**
     * Engancha las listas a una vista web concreta.
     *
     * La vista la crea react-native-webview, que no expone su configuración, así
     * que se la busca por su número de vista y se baja por el árbol hasta dar con
     * la WKWebView. Las reglas se aplican a las cargas siguientes, no a la página
     * que ya está abierta: por eso quien llama recarga después.
     */
    AsyncFunction("applyTo") { (viewTag: Int, identifiers: [String], promise: Promise) in
      DispatchQueue.main.async {
        guard let root = self.appContext?.findView(withTag: viewTag, ofType: UIView.self),
              let webView = Self.findWebView(in: root)
        else {
          promise.reject("sin_vista", "No se encontró la vista web \(viewTag)")
          return
        }

        let controller = webView.configuration.userContentController
        controller.removeAllContentRuleLists()
        var faltantes: [String] = []
        for id in identifiers {
          if let list = self.loaded[id] {
            controller.add(list)
          } else {
            faltantes.append(id)
          }
        }
        promise.resolve(faltantes)
      }
    }

    /// Saca todas las reglas de una vista: es el "apagar el escudo en este sitio".
    AsyncFunction("clearFrom") { (viewTag: Int, promise: Promise) in
      DispatchQueue.main.async {
        guard let root = self.appContext?.findView(withTag: viewTag, ofType: UIView.self),
              let webView = Self.findWebView(in: root)
        else {
          promise.resolve(false)
          return
        }
        webView.configuration.userContentController.removeAllContentRuleLists()
        promise.resolve(true)
      }
    }
  }

  /// Baja por el árbol de vistas hasta encontrar la WKWebView.
  private static func findWebView(in view: UIView) -> WKWebView? {
    if let web = view as? WKWebView { return web }
    for sub in view.subviews {
      if let found = findWebView(in: sub) { return found }
    }
    return nil
  }
}
